$ErrorActionPreference = "Stop"
$base = "http://localhost:3000/api/v1"
$suffix = Get-Random -Maximum 99999

function Step($name, $block) {
  try {
    $result = & $block
    Write-Host "OK   $name"
    return $result
  } catch {
    Write-Host "FAIL $name : $($_.ErrorDetails.Message)"
    throw
  }
}

function ExpectFail($name, $expectedStatus, $block) {
  try {
    & $block
    Write-Host "FAIL $name : expected an error, got success"
  } catch {
    $actual = $_.Exception.Response.StatusCode
    if ($expectedStatus -and [int]$actual -ne $expectedStatus) {
      Write-Host "FAIL $name : expected HTTP $expectedStatus, got $actual : $($_.ErrorDetails.Message)"
    } else {
      Write-Host "OK   $name correctly failed: $actual : $($_.ErrorDetails.Message)"
    }
  }
}

# ============================================================================
# 0. Seed three distinct actors (AC-31 segregation of duties) - safe/idempotent
# ============================================================================
Write-Host "--- seeding harvester/verifier/manager users (idempotent) ---"
$env:SEED_TECH_EMAIL = "dism-harvester-$suffix@jackys.com"; $env:SEED_TECH_PASSWORD = "Harvest123!"; $env:SEED_TECH_ROLE = "TECHNICIAN_WORKSHOP"
npm run seed:technician 2>&1 | Out-Null
$env:SEED_TECH_EMAIL = "dism-verifier-$suffix@jackys.com"; $env:SEED_TECH_PASSWORD = "Verify123!"; $env:SEED_TECH_ROLE = "TECHNICAL_TEAM_LEADER"
npm run seed:technician 2>&1 | Out-Null
$env:SEED_TECH_EMAIL = "dism-manager-$suffix@jackys.com"; $env:SEED_TECH_PASSWORD = "Manage123!"; $env:SEED_TECH_ROLE = "SERVICE_HEAD"
npm run seed:technician 2>&1 | Out-Null
Remove-Item Env:\SEED_TECH_EMAIL, Env:\SEED_TECH_PASSWORD, Env:\SEED_TECH_ROLE -ErrorAction SilentlyContinue

$adminResp = Step "login as admin" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"admin@jackys.com","password":"Admin123!"}' }
$Hadmin = @{ Authorization = "Bearer $($adminResp.accessToken)" }

$harvesterResp = Step "login as harvester" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "dism-harvester-$suffix@jackys.com"; password = "Harvest123!" } | ConvertTo-Json) }
$Hharvester = @{ Authorization = "Bearer $($harvesterResp.accessToken)" }

$verifierResp = Step "login as verifier" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "dism-verifier-$suffix@jackys.com"; password = "Verify123!" } | ConvertTo-Json) }
$Hverifier = @{ Authorization = "Bearer $($verifierResp.accessToken)" }

$managerResp = Step "login as service manager" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "dism-manager-$suffix@jackys.com"; password = "Manage123!" } | ConvertTo-Json) }
$Hmanager = @{ Authorization = "Bearer $($managerResp.accessToken)" }

# ============================================================================
# 1. Master data: a model, a spare part linked to it, and BOM/yield entries
#    (one RECOVERABLE_SPARE, one CONSUMABLE - to prove step 15.5's exclusion)
# ============================================================================
$modelId = "DISM-MODEL-$suffix"
$model = Step "create spare part model" { Invoke-RestMethod -Uri "$base/master-data/spare-part-models" -Method Post -Headers $Hadmin -ContentType "application/json" -Body (@{
  modelId = $modelId; brand = "TestBrand"; modelName = "Dismantling Test Model"
} | ConvertTo-Json) }

$sparePart = Step "create recovered spare part" { Invoke-RestMethod -Uri "$base/master-data/spare-parts" -Method Post -Headers $Hadmin -ContentType "application/json" -Body (@{
  code = "DISM-SP-$suffix"; name = "Recovered Compressor $suffix"; category = "COMPRESSOR"; unitCost = 0
} | ConvertTo-Json) }

# link-model expects the SparePartModel row's UUID (model.id), not the plain modelId string tag
Step "link spare part to model" { Invoke-RestMethod -Uri "$base/master-data/spare-parts/$($sparePart.id)/link-model" -Method Post -Headers $Hadmin -ContentType "application/json" -Body (@{ modelId = $model.id } | ConvertTo-Json) }

# A spare part deliberately NOT linked to any model - to prove the AC-17-style gate blocks posting
$unlinkedSparePart = Step "create UNLINKED spare part (for the negative model-link test)" { Invoke-RestMethod -Uri "$base/master-data/spare-parts" -Method Post -Headers $Hadmin -ContentType "application/json" -Body (@{
  code = "DISM-SP-UNLINKED-$suffix"; name = "Unlinked Recovered Part $suffix"; category = "MISC"; unitCost = 0
} | ConvertTo-Json) }

Step "component-yield entry: RECOVERABLE_SPARE (linked)" { Invoke-RestMethod -Uri "$base/master-data/component-yield" -Method Post -Headers $Hadmin -ContentType "application/json" -Body (@{
  modelId = $modelId; originalBomItemCode = "COMP-COMPRESSOR-$suffix"; itemName = "Compressor Unit"; category = "RECOVERABLE_SPARE"
  defaultRecoveryEvaluation = 50; convertedSparePartCode = $sparePart.code
} | ConvertTo-Json) }

Step "component-yield entry: CONSUMABLE (excluded per step 15.5)" { Invoke-RestMethod -Uri "$base/master-data/component-yield" -Method Post -Headers $Hadmin -ContentType "application/json" -Body (@{
  modelId = $modelId; originalBomItemCode = "COMP-GASKET-$suffix"; itemName = "Door Gasket"; category = "CONSUMABLE"
  defaultRecoveryEvaluation = 0
} | ConvertTo-Json) }

Step "component-yield entry: RECOVERABLE_SPARE but UNLINKED spare part" { Invoke-RestMethod -Uri "$base/master-data/component-yield" -Method Post -Headers $Hadmin -ContentType "application/json" -Body (@{
  modelId = $modelId; originalBomItemCode = "COMP-UNLINKED-$suffix"; itemName = "Unlinked Part"; category = "RECOVERABLE_SPARE"
  defaultRecoveryEvaluation = 20; convertedSparePartCode = $unlinkedSparePart.code
} | ConvertTo-Json) }

$stockBefore = Step "check stock before posting (should be 0/none)" { try { Invoke-RestMethod -Uri "$base/inventory/stock/$($sparePart.id)" -Headers $Hadmin } catch { $null } }
$qtyBefore = if ($stockBefore) { $stockBefore.quantityOnHand } else { 0 }

# ============================================================================
# 2. Happy path: create -> harvest -> verify -> price-and-post
# ============================================================================
$record = Step "create dismantling record (step 15.1)" { Invoke-RestMethod -Uri "$base/dismantling" -Method Post -Headers $Hharvester -ContentType "application/json" -Body (@{
  applianceSerialNumber = "DISM-SN-$suffix"; modelId = $modelId; damageLocationNotes = "Confirmed DOA, Damage Location bay 3"
} | ConvertTo-Json) }
if ($record.status -ne "PENDING_HARVEST") { Write-Host "FAIL create: expected PENDING_HARVEST, got $($record.status)" } else { Write-Host "OK   status is PENDING_HARVEST" }

ExpectFail "verify before harvest logged" 400 { Invoke-RestMethod -Uri "$base/dismantling/$($record.id)/verify" -Method Post -Headers $Hverifier -ContentType "application/json" -Body '{}' }

$harvested = Step "log harvested components (steps 15.2-15.3)" { Invoke-RestMethod -Uri "$base/dismantling/$($record.id)/harvest" -Method Post -Headers $Hharvester -ContentType "application/json" -Body (@{
  components = @(
    @{ originalBomItemCode = "COMP-COMPRESSOR-$suffix"; testedCondition = "GOOD_WORKING"; quantity = 1 },
    @{ originalBomItemCode = "COMP-GASKET-$suffix"; testedCondition = "GOOD_WORKING"; quantity = 2 }
  )
} | ConvertTo-Json -Depth 5) }
if ($harvested.status -ne "COMPONENTS_LOGGED") { Write-Host "FAIL harvest: expected COMPONENTS_LOGGED, got $($harvested.status)" } else { Write-Host "OK   status is COMPONENTS_LOGGED" }
$compressorEntry = $harvested.harvestedComponents | Where-Object { $_.originalBomItemCode -eq "COMP-COMPRESSOR-$suffix" }
$gasketEntry = $harvested.harvestedComponents | Where-Object { $_.originalBomItemCode -eq "COMP-GASKET-$suffix" }
if ($compressorEntry.eligibleForConversion -ne $true) { Write-Host "FAIL: compressor should be eligibleForConversion=true" } else { Write-Host "OK   compressor eligibleForConversion=true" }
if ($gasketEntry.eligibleForConversion -ne $false) { Write-Host "FAIL: gasket (CONSUMABLE) should be eligibleForConversion=false" } else { Write-Host "OK   gasket (CONSUMABLE) correctly eligibleForConversion=false" }

# NOTE: verify/price-and-post are role-gated (TECHNICIAN_WORKSHOP - the harvester's role
# here - holds neither), so a same-person-as-harvester call using $Hharvester would be
# blocked by the ROLE guard (403) before ever reaching the AC-31 service-level check. The
# isolated segregation-of-duties tests below use accounts whose role passes every guard
# involved, so the 400 actually comes from DismantlingService's own check - see further
# down (record 4 / record 5).
ExpectFail "price-and-post before verification" 400 { Invoke-RestMethod -Uri "$base/dismantling/$($record.id)/price-and-post" -Method Post -Headers $Hmanager -ContentType "application/json" -Body (@{ conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-$suffix"; recoveryUnitPrice = 85 }) } | ConvertTo-Json -Depth 5) }

$verified = Step "verify by a DIFFERENT person (AC-31)" { Invoke-RestMethod -Uri "$base/dismantling/$($record.id)/verify" -Method Post -Headers $Hverifier -ContentType "application/json" -Body (@{ notes = "Confirmed compressor tests good" } | ConvertTo-Json) }
if ($verified.status -ne "VERIFIED") { Write-Host "FAIL verify: expected VERIFIED, got $($verified.status)" } else { Write-Host "OK   status is VERIFIED" }

ExpectFail "price-and-post on the excluded CONSUMABLE component" 400 { Invoke-RestMethod -Uri "$base/dismantling/$($record.id)/price-and-post" -Method Post -Headers $Hmanager -ContentType "application/json" -Body (@{ conversions = @(@{ originalBomItemCode = "COMP-GASKET-$suffix"; recoveryUnitPrice = 5 }) } | ConvertTo-Json -Depth 5) }

$posted = Step "price-and-post by the Service Manager (steps 15.4-15.6, AC-39/AC-30)" { Invoke-RestMethod -Uri "$base/dismantling/$($record.id)/price-and-post" -Method Post -Headers $Hmanager -ContentType "application/json" -Body (@{
  conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-$suffix"; recoveryUnitPrice = 85; quantityToConvert = 1 })
} | ConvertTo-Json -Depth 5) }
if ($posted.status -ne "POSTED") { Write-Host "FAIL post: expected POSTED, got $($posted.status)" } else { Write-Host "OK   status is POSTED" }
if ($posted.totalRecoveredValue -ne 85) { Write-Host "FAIL post: expected totalRecoveredValue=85, got $($posted.totalRecoveredValue)" } else { Write-Host "OK   totalRecoveredValue=85" }
if ($posted.pricedByUserId -ne $managerResp.user.id -and $posted.pricedByUserId -eq $null) { Write-Host "FAIL post: pricedByUserId not set" } else { Write-Host "OK   pricedByUserId set" }

ExpectFail "re-posting an already-POSTED record" 400 { Invoke-RestMethod -Uri "$base/dismantling/$($record.id)/price-and-post" -Method Post -Headers $Hmanager -ContentType "application/json" -Body (@{ conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-$suffix"; recoveryUnitPrice = 85 }) } | ConvertTo-Json -Depth 5) }

# ============================================================================
# 3. Verify AC-30: inventory actually increased, and the GL entry landed
# ============================================================================
$stockAfter = Step "check MAIN_STORE stock after posting" { Invoke-RestMethod -Uri "$base/inventory/stock/$($sparePart.id)" -Headers $Hadmin }
if ($stockAfter.quantityOnHand -ne ($qtyBefore + 1)) { Write-Host "FAIL AC-30: expected quantityOnHand=$($qtyBefore + 1), got $($stockAfter.quantityOnHand)" } else { Write-Host "OK   AC-30: MAIN_STORE quantityOnHand increased by 1" }

$glPostings = Step "check GL postings for this record" { Invoke-RestMethod -Uri "$base/gl-postings?sourceType=DISMANTLING_RECOVERY" -Headers $Hadmin }
$ourPosting = $glPostings | Where-Object { $_.sourceId -eq $record.id }
if (-not $ourPosting) { Write-Host "FAIL: no GL posting found for this dismantling record" } elseif ($ourPosting.amount -ne "85.00" -and $ourPosting.amount -ne 85) { Write-Host "FAIL: GL posting amount is $($ourPosting.amount), expected 85" } else { Write-Host "OK   GL posting found, amount=$($ourPosting.amount)" }

# ============================================================================
# 4. Reads
# ============================================================================
Step "GET by id" { Invoke-RestMethod -Uri "$base/dismantling/$($record.id)" -Headers $Hadmin } | Out-Null
Step "GET by appliance serial" { Invoke-RestMethod -Uri "$base/dismantling/serial/DISM-SN-$suffix" -Headers $Hadmin } | Out-Null
Step "GET list filtered by status=POSTED" { Invoke-RestMethod -Uri "$base/dismantling?status=POSTED" -Headers $Hadmin } | Out-Null

# ============================================================================
# 5. AC-17-style model-link gate on an unlinked converted spare part
# ============================================================================
$record2 = Step "create a second record (for the unlinked-spare-part negative test)" { Invoke-RestMethod -Uri "$base/dismantling" -Method Post -Headers $Hharvester -ContentType "application/json" -Body (@{
  applianceSerialNumber = "DISM-SN2-$suffix"; modelId = $modelId
} | ConvertTo-Json) }
Step "harvest on record 2" { Invoke-RestMethod -Uri "$base/dismantling/$($record2.id)/harvest" -Method Post -Headers $Hharvester -ContentType "application/json" -Body (@{
  components = @(@{ originalBomItemCode = "COMP-UNLINKED-$suffix"; testedCondition = "GOOD_WORKING"; quantity = 1 })
} | ConvertTo-Json -Depth 5) } | Out-Null
Step "verify record 2" { Invoke-RestMethod -Uri "$base/dismantling/$($record2.id)/verify" -Method Post -Headers $Hverifier -ContentType "application/json" -Body '{}' } | Out-Null
ExpectFail "post record 2 - converted spare part has no linked model" 400 { Invoke-RestMethod -Uri "$base/dismantling/$($record2.id)/price-and-post" -Method Post -Headers $Hmanager -ContentType "application/json" -Body (@{ conversions = @(@{ originalBomItemCode = "COMP-UNLINKED-$suffix"; recoveryUnitPrice = 20 }) } | ConvertTo-Json -Depth 5) }

# ============================================================================
# 5b. AC-31 segregation-of-duties, isolated at the SERVICE layer (not the role guard) -
#     the verifier account (TECHNICAL_TEAM_LEADER) passes both the harvest-roles and
#     verify-roles guards, so harvesting-then-verifying with that SAME account reaches
#     DismantlingService.verify()'s own check rather than being stopped at 403 first.
# ============================================================================
$record4 = Step "create record 4 (isolated verify-same-person test)" { Invoke-RestMethod -Uri "$base/dismantling" -Method Post -Headers $Hverifier -ContentType "application/json" -Body (@{
  applianceSerialNumber = "DISM-SN4-$suffix"; modelId = $modelId
} | ConvertTo-Json) }
Step "harvest record 4 (as the TL account itself)" { Invoke-RestMethod -Uri "$base/dismantling/$($record4.id)/harvest" -Method Post -Headers $Hverifier -ContentType "application/json" -Body (@{
  components = @(@{ originalBomItemCode = "COMP-COMPRESSOR-$suffix"; testedCondition = "GOOD_WORKING"; quantity = 1 })
} | ConvertTo-Json -Depth 5) } | Out-Null
ExpectFail "verify record 4 by the SAME account that harvested it (AC-31, service-level)" 400 { Invoke-RestMethod -Uri "$base/dismantling/$($record4.id)/verify" -Method Post -Headers $Hverifier -ContentType "application/json" -Body '{}' }

# The manager account (SERVICE_HEAD) passes ALL THREE role guards. Record 5 isolates
# "poster same as harvester" (harvest as manager, verify as the TL, post attempt as
# manager again). Record 6 isolates "poster same as verifier" (harvest as TL, verify as
# manager, post attempt as manager again) - two distinct accounts as harvester/verifier so
# the verify step itself passes, then the poster collides with whichever one it repeats.
$record5 = Step "create record 5 (isolated post-same-as-harvester test)" { Invoke-RestMethod -Uri "$base/dismantling" -Method Post -Headers $Hmanager -ContentType "application/json" -Body (@{
  applianceSerialNumber = "DISM-SN5-$suffix"; modelId = $modelId
} | ConvertTo-Json) }
Step "harvest record 5 (as the manager account)" { Invoke-RestMethod -Uri "$base/dismantling/$($record5.id)/harvest" -Method Post -Headers $Hmanager -ContentType "application/json" -Body (@{
  components = @(@{ originalBomItemCode = "COMP-COMPRESSOR-$suffix"; testedCondition = "GOOD_WORKING"; quantity = 1 })
} | ConvertTo-Json -Depth 5) } | Out-Null
Step "verify record 5 (as the TL account - different from the manager who harvested)" { Invoke-RestMethod -Uri "$base/dismantling/$($record5.id)/verify" -Method Post -Headers $Hverifier -ContentType "application/json" -Body '{}' } | Out-Null
ExpectFail "price-and-post record 5 by the SAME account that harvested it (AC-31, service-level)" 400 { Invoke-RestMethod -Uri "$base/dismantling/$($record5.id)/price-and-post" -Method Post -Headers $Hmanager -ContentType "application/json" -Body (@{ conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-$suffix"; recoveryUnitPrice = 85 }) } | ConvertTo-Json -Depth 5) }

$record6 = Step "create record 6 (isolated post-same-as-verifier test)" { Invoke-RestMethod -Uri "$base/dismantling" -Method Post -Headers $Hverifier -ContentType "application/json" -Body (@{
  applianceSerialNumber = "DISM-SN6-$suffix"; modelId = $modelId
} | ConvertTo-Json) }
Step "harvest record 6 (as the TL account)" { Invoke-RestMethod -Uri "$base/dismantling/$($record6.id)/harvest" -Method Post -Headers $Hverifier -ContentType "application/json" -Body (@{
  components = @(@{ originalBomItemCode = "COMP-COMPRESSOR-$suffix"; testedCondition = "GOOD_WORKING"; quantity = 1 })
} | ConvertTo-Json -Depth 5) } | Out-Null
Step "verify record 6 (as the manager account - different from the TL who harvested)" { Invoke-RestMethod -Uri "$base/dismantling/$($record6.id)/verify" -Method Post -Headers $Hmanager -ContentType "application/json" -Body '{}' } | Out-Null
ExpectFail "price-and-post record 6 by the SAME account that verified it (AC-31, service-level)" 400 { Invoke-RestMethod -Uri "$base/dismantling/$($record6.id)/price-and-post" -Method Post -Headers $Hmanager -ContentType "application/json" -Body (@{ conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-$suffix"; recoveryUnitPrice = 85 }) } | ConvertTo-Json -Depth 5) }

# ============================================================================
# 6. Cancel flow
# ============================================================================
$record3 = Step "create a third record (for the cancel test)" { Invoke-RestMethod -Uri "$base/dismantling" -Method Post -Headers $Hharvester -ContentType "application/json" -Body (@{
  applianceSerialNumber = "DISM-SN3-$suffix"; modelId = $modelId
} | ConvertTo-Json) }
$cancelled = Step "cancel while PENDING_HARVEST" { Invoke-RestMethod -Uri "$base/dismantling/$($record3.id)/cancel" -Method Post -Headers $Hharvester -ContentType "application/json" -Body (@{ reason = "Nothing salvageable after inspection" } | ConvertTo-Json) }
if ($cancelled.status -ne "CANCELLED") { Write-Host "FAIL cancel: expected CANCELLED, got $($cancelled.status)" } else { Write-Host "OK   status is CANCELLED" }

ExpectFail "cancel an already-VERIFIED record (record 2)" 400 { Invoke-RestMethod -Uri "$base/dismantling/$($record2.id)/cancel" -Method Post -Headers $Hharvester -ContentType "application/json" -Body (@{ reason = "too late" } | ConvertTo-Json) }

Write-Host ""
Write-Host "=== Dismantling E2E test complete ==="
