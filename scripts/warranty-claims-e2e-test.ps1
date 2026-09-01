$ErrorActionPreference = "Stop"
$base = "http://localhost:3000/api/v1"
$suffix = Get-Random -Maximum 99999
# Zero-padded so it can be embedded inside a fixed-width lexicographic serial range below
# without breaking the BETWEEN split_part(...) comparison's width assumptions.
$suffix5 = "{0:D5}" -f $suffix

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
# 0. Login as admin, seed a Warranty Clerk, an Accountant, and the usual
#    field/workshop/QC-approver trio needed to drive a Job Card to CONSUMED
#    spares (same pipeline as Phase 6's inventory E2E test).
# ============================================================================
$resp = Step "login as admin" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"admin@jackys.com","password":"Admin123!"}' }
$H = @{ Authorization = "Bearer $($resp.accessToken)" }

$clerkEmail = "wc-clerk-$suffix@jackys.com"
$acctEmail = "wc-accountant-$suffix@jackys.com"
$fieldEmail = "wc-field-$suffix@jackys.com"
$workshopEmail = "wc-workshop-$suffix@jackys.com"
$qcEmail = "wc-qc-$suffix@jackys.com"

Step "seed warranty clerk" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$clerkEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='WARRANTY_CLERK'; npm run seed:technician" } | Out-Null
Step "seed accountant" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$acctEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='ACCOUNTANT'; npm run seed:technician" } | Out-Null
Step "seed field technician" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$fieldEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='TECHNICIAN_FIELD'; npm run seed:technician" } | Out-Null
$workshopSeedOut = Step "seed workshop technician" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$workshopEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='TECHNICIAN_WORKSHOP'; npm run seed:technician" }
$workshopTechId = ($workshopSeedOut | Select-String -Pattern "user id:\s*(\S+)").Matches[0].Groups[1].Value
$qcSeedOut = Step "seed QC-eligible CCE user (not yet QC-granted)" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$qcEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='CCE'; npm run seed:technician" }
$qcUserId = ($qcSeedOut | Select-String -Pattern "user id:\s*(\S+)").Matches[0].Groups[1].Value

$clerkResp = Step "login as warranty clerk" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $clerkEmail; password = "Pass123!" } | ConvertTo-Json) }
$Hclerk = @{ Authorization = "Bearer $($clerkResp.accessToken)" }
$acctResp = Step "login as accountant" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $acctEmail; password = "Pass123!" } | ConvertTo-Json) }
$Hacct = @{ Authorization = "Bearer $($acctResp.accessToken)" }
$fieldLogin = Step "login as field technician" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $fieldEmail; password = "Pass123!" } | ConvertTo-Json) }
$Hfield = @{ Authorization = "Bearer $($fieldLogin.accessToken)" }
$fieldTechId = $fieldLogin.user.id
$workshopLogin = Step "login as workshop technician" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $workshopEmail; password = "Pass123!" } | ConvertTo-Json) }
$WH = @{ Authorization = "Bearer $($workshopLogin.accessToken)" }
$qcLogin = Step "login as CCE (future QC approver)" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $qcEmail; password = "Pass123!" } | ConvertTo-Json) }
$QCH = @{ Authorization = "Bearer $($qcLogin.accessToken)" }

# ============================================================================
# 1. Master data: a model, a spare part (unitCost=100), GRN stock, and TWO
#    WarrantyMaster entries (two different vendors) so aggregate()'s
#    supplier filter has something real to prove.
# ============================================================================
$sc = Step "create service centre" { Invoke-RestMethod -Uri "$base/master-data/service-centres" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  code = "WC-$suffix"; name = "Warranty Claims Test Centre"; country = "UAE"; vatRate = 5.0
  schedule = @{ monday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 } }
} | ConvertTo-Json -Depth 5) }

$fs = Step "create fault-symptom" { Invoke-RestMethod -Uri "$base/master-data/fault-symptoms" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  faultCode = "WCF$suffix"; faultDescription = "Test fault"; symptomCode = "WCS$suffix"; symptomDescription = "Test symptom"; category = "WASHING_MACHINE"
} | ConvertTo-Json) }

$model = Step "create spare part model" { Invoke-RestMethod -Uri "$base/master-data/spare-part-models" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  modelId = "WCMODEL$suffix"; brand = "Samsung"; modelName = "Warranty Claims Test Model"
} | ConvertTo-Json) }

$part = Step "create + link spare part (unitCost=100)" {
  $p = Invoke-RestMethod -Uri "$base/master-data/spare-parts" -Method Post -Headers $H -ContentType "application/json" -Body (@{ code = "WC-SP-$suffix"; name = "Warranty Test Motor"; category = "MOTOR"; unitCost = 100 } | ConvertTo-Json)
  Invoke-RestMethod -Uri "$base/master-data/spare-parts/$($p.id)/link-model" -Method Post -Headers $H -ContentType "application/json" -Body (@{ modelId = $model.id } | ConvertTo-Json) | Out-Null
  return $p
}
Step "GRN part: 20 units" { Invoke-RestMethod -Uri "$base/inventory/grn" -Method Post -Headers $H -ContentType "application/json" -Body (@{ sparePartId = $part.id; quantity = 20 } | ConvertTo-Json) } | Out-Null

$supplierA = "WC-Vendor-A-$suffix"
$supplierB = "WC-Vendor-B-$suffix"
# Lexicographic bounds (findWarrantyBySerial compares serial numbers as strings between
# split_part(range,'-',1) and split_part(range,'-',2)) - fixed-width zero-padded serials
# keep this well-defined.
#
# The range prefix embeds $suffix5 (not just "WCA"/"WCB") so this run's range never overlaps
# a PREVIOUS run's leftover WarrantyMaster row. checkWarranty()/findWarrantyBySerial() filters
# only by serial-range match + brand (no model filter, and no ORDER BY - it takes warranties[0]
# of however many rows match), and this is a real dev DB that nothing resets between runs - a
# literal, non-suffixed range like "WCA00000-WCA99999" would match every past run's row too,
# and checkWarranty() could arbitrarily return an old run's supplier instead of this run's.
# Caught live: second run's jcA1/jcB1.warrantySupplier came back as an EARLIER run's supplier
# string, not this run's - not a PowerShell variable bug, a cross-run WarrantyMaster collision.
Step "warranty-master: vendor A covers WCA${suffix5}00000-WCA${suffix5}99999" { Invoke-RestMethod -Uri "$base/master-data/warranty-master" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  serialNumberRange = "WCA${suffix5}00000-WCA${suffix5}99999"; brand = "Samsung"; model = "WCMODEL$suffix"; warrantyPeriodMonths = 24; supplier = $supplierA
} | ConvertTo-Json) } | Out-Null
Step "warranty-master: vendor B covers WCB${suffix5}00000-WCB${suffix5}99999" { Invoke-RestMethod -Uri "$base/master-data/warranty-master" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  serialNumberRange = "WCB${suffix5}00000-WCB${suffix5}99999"; brand = "Samsung"; model = "WCMODEL$suffix"; warrantyPeriodMonths = 24; supplier = $supplierB
} | ConvertTo-Json) } | Out-Null

# ============================================================================
# 2. Helper: appointment -> field visit (warranty-registered S/N -> IN_WARRANTY
#    + warrantySupplier snapshot) -> job card -> workshop -> reserve -> complete
#    -> QC approve (consumes the reservation, sets consumedAt).
# ============================================================================
$script:jobSlotOffset = 0
function NewWarrantyJob($serialPrefix, $faultLabel, $qty) {
  $phoneSuffix = Get-Random -Maximum 99999
  $script:jobSlotOffset += 2
  $slotHour = 8 + $script:jobSlotOffset
  $scheduledAtStr = "2026-08-26T$("{0:D2}" -f $slotHour):00:00Z"
  $serial = "$serialPrefix$("{0:D5}" -f (Get-Random -Maximum 90000))"
  $apt = Invoke-RestMethod -Uri "$base/appointments" -Method Post -Headers $H -ContentType "application/json" -Body (@{
    type = "WARRANTY"; customerType = "B2C"; customerName = "WC Customer $faultLabel"; customerPhone = "+97150$phoneSuffix"; customerEmail = "wccustomer$suffix$faultLabel@example.com"
    scheduledAt = $scheduledAtStr; serviceCentreId = $sc.id; brand = "Samsung"; modelNumber = "WCMODEL$suffix"; invoiceNumber = "INV-WC-$suffix-$faultLabel"
  } | ConvertTo-Json)

  Invoke-RestMethod -Uri "$base/appointments/$($apt.id)/assign-technician" -Method Put -Headers $H -ContentType "application/json" -Body (@{ technicianId = $fieldTechId } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/start" -Method Post -Headers $Hfield -ContentType "application/json" -Body '{"gpsLat":25.2048,"gpsLng":55.2708}' | Out-Null
  $visit = Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/serial-number" -Method Post -Headers $Hfield -ContentType "application/json" -Body (@{ serialNumber = $serial; brand = "Samsung" } | ConvertTo-Json)
  if ($visit.warrantyStatus -ne "IW") { Write-Host "FAIL $faultLabel : expected visit warrantyStatus IW (serial $serial should have matched a WarrantyMaster row), got $($visit.warrantyStatus)" }
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/fault-symptom" -Method Post -Headers $Hfield -ContentType "application/json" -Body (@{ faultCode = "WCF$suffix"; symptomCode = "WCS$suffix" } | ConvertTo-Json) | Out-Null

  $jc = Invoke-RestMethod -Uri "$base/job-cards" -Method Post -Headers $H -ContentType "application/json" -Body (@{ appointmentId = $apt.id } | ConvertTo-Json)
  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/validate-sn" -Method Post -Headers $H -ContentType "application/json" -Body '{"matches":true}'
  if ($jc.warrantyStatus -ne "IW") { Write-Host "FAIL $faultLabel : expected job card warrantyStatus IW, got $($jc.warrantyStatus)" }
  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/assign-section" -Method Post -Headers $H -ContentType "application/json" -Body '{"section":"WORKSHOP"}'
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/assign" -Method Post -Headers $H -ContentType "application/json" -Body (@{ technicianId = $workshopTechId } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/start-wip" -Method Post -Headers $WH | Out-Null
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $part.id; quantity = $qty } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/complete" -Method Post -Headers $WH | Out-Null
  $approved = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/qc/approve" -Method Post -Headers $QCH
  return $approved
}

$grant = Step "admin grants QC_APPROVAL to the CCE" { Invoke-RestMethod -Uri "$base/permissions/grant" -Method Post -Headers $H -ContentType "application/json" -Body (@{ userId = $qcUserId; permissionType = "QC_APPROVAL"; notes = "Warranty Claims E2E" } | ConvertTo-Json) }
Write-Output "QC grant issued: id=$($grant.id)"

# ============================================================================
# 3. Consume warranty spares: vendor A gets two Job Cards (qty 2 + qty 3 =
#    500.00 total at unitCost 100), vendor B gets one (qty 1 = 100.00) held
#    back for the cancel-flow test.
# ============================================================================
$jcA1 = Step "vendor A, job 1: full pipeline to CONSUMED (qty 2)" { NewWarrantyJob "WCA$suffix5" "A1" 2 }
Write-Output "jcA1 warrantySupplier=$($jcA1.warrantySupplier), status=$($jcA1.status)"
$jcA2 = Step "vendor A, job 2: full pipeline to CONSUMED (qty 3)" { NewWarrantyJob "WCA$suffix5" "A2" 3 }
Write-Output "jcA2 warrantySupplier=$($jcA2.warrantySupplier), status=$($jcA2.status)"
$jcB1 = Step "vendor B, job 1: full pipeline to CONSUMED (qty 1, for the cancel-flow test)" { NewWarrantyJob "WCB$suffix5" "B1" 1 }
Write-Output "jcB1 warrantySupplier=$($jcB1.warrantySupplier), status=$($jcB1.status)"

if ($jcA1.warrantySupplier -ne $supplierA) { Write-Host "FAIL: jcA1.warrantySupplier expected '$supplierA', got '$($jcA1.warrantySupplier)'" } else { Write-Host "OK   jcA1.warrantySupplier snapshot matches vendor A" }
if ($jcB1.warrantySupplier -ne $supplierB) { Write-Host "FAIL: jcB1.warrantySupplier expected '$supplierB', got '$($jcB1.warrantySupplier)'" } else { Write-Host "OK   jcB1.warrantySupplier snapshot matches vendor B" }

$today = Get-Date
$periodStart = $today.AddDays(-1).ToString("yyyy-MM-dd")
$periodEnd = $today.AddDays(1).ToString("yyyy-MM-dd")

# ============================================================================
# 4. RBAC
# ============================================================================
ExpectFail "field tech cannot aggregate (403)" 403 { Invoke-RestMethod -Uri "$base/warranty-claims/aggregate" -Method Post -Headers $Hfield -ContentType "application/json" -Body (@{ supplier = $supplierA; periodStart = $periodStart; periodEnd = $periodEnd } | ConvertTo-Json) }
ExpectFail "accountant cannot aggregate (403 - not a clerk role)" 403 { Invoke-RestMethod -Uri "$base/warranty-claims/aggregate" -Method Post -Headers $Hacct -ContentType "application/json" -Body (@{ supplier = $supplierA; periodStart = $periodStart; periodEnd = $periodEnd } | ConvertTo-Json) }
ExpectFail "no token cannot list claims (401)" 401 { Invoke-RestMethod -Uri "$base/warranty-claims" -Method Get }
ExpectFail "field tech cannot list claims (403)" 403 { Invoke-RestMethod -Uri "$base/warranty-claims" -Method Get -Headers $Hfield }
Step "accountant CAN list claims (view role)" { Invoke-RestMethod -Uri "$base/warranty-claims" -Method Get -Headers $Hacct } | Out-Null
Step "warranty clerk CAN list claims (view role)" { Invoke-RestMethod -Uri "$base/warranty-claims" -Method Get -Headers $Hclerk } | Out-Null

# ============================================================================
# 5. Aggregate (BRD 12.1) + double-claim prevention
# ============================================================================
ExpectFail "aggregate rejects periodStart after periodEnd" 400 { Invoke-RestMethod -Uri "$base/warranty-claims/aggregate" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ supplier = $supplierA; periodStart = $periodEnd; periodEnd = $periodStart } | ConvertTo-Json) }
ExpectFail "aggregate rejects a supplier with nothing consumed" 400 { Invoke-RestMethod -Uri "$base/warranty-claims/aggregate" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ supplier = "WC-Vendor-Nobody-$suffix"; periodStart = $periodStart; periodEnd = $periodEnd } | ConvertTo-Json) }

$claimA = Step "aggregate vendor A's two consumed spares into a DRAFT claim" { Invoke-RestMethod -Uri "$base/warranty-claims/aggregate" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ supplier = $supplierA; periodStart = $periodStart; periodEnd = $periodEnd } | ConvertTo-Json) }
if ($claimA.status -ne "DRAFT") { Write-Host "FAIL: expected DRAFT, got $($claimA.status)" } else { Write-Host "OK   claimA status is DRAFT" }
if ($claimA.claimNumber -notmatch '^WC-\d{4}$') { Write-Host "FAIL: claimNumber '$($claimA.claimNumber)' doesn't match WC-####" } else { Write-Host "OK   claimNumber is $($claimA.claimNumber)" }
if ($claimA.lines.Count -ne 2) { Write-Host "FAIL: expected 2 lines, got $($claimA.lines.Count)" } else { Write-Host "OK   claimA has 2 lines (both vendor A job cards)" }
if ([decimal]$claimA.totalClaimedAmount -ne 500) { Write-Host "FAIL: expected totalClaimedAmount=500 (2*100 + 3*100), got $($claimA.totalClaimedAmount)" } else { Write-Host "OK   totalClaimedAmount=500" }
$line1 = $claimA.lines | Where-Object { $_.jobCardId -eq $jcA1.id }
if (-not $line1 -or $line1.jobCardNumber -ne $jcA1.jobCardNumber -or [string]::IsNullOrEmpty($line1.serialNumber)) {
  Write-Host "FAIL: claim line jobCardNumber/serialNumber snapshot missing or wrong for jcA1 - this is the regression check for the entity-class-join bug (TypeORM silently never hydrated it) that was caught and fixed before this endpoint even existed"
} else {
  Write-Host "OK   claim line correctly snapshots jobCardNumber='$($line1.jobCardNumber)' and serialNumber='$($line1.serialNumber)' from the joined JobCard"
}

ExpectFail "re-aggregating vendor A over the same period finds nothing left unclaimed (double-claim prevention)" 400 { Invoke-RestMethod -Uri "$base/warranty-claims/aggregate" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ supplier = $supplierA; periodStart = $periodStart; periodEnd = $periodEnd } | ConvertTo-Json) }

# ============================================================================
# 6. Cancel flow (the-fool finding #3: DRAFT dead-end fix) - vendor B
# ============================================================================
$claimB1 = Step "aggregate vendor B's one consumed spare into a DRAFT claim" { Invoke-RestMethod -Uri "$base/warranty-claims/aggregate" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ supplier = $supplierB; periodStart = $periodStart; periodEnd = $periodEnd } | ConvertTo-Json) }
if ([decimal]$claimB1.totalClaimedAmount -ne 100) { Write-Host "FAIL: expected claimB1 totalClaimedAmount=100, got $($claimB1.totalClaimedAmount)" } else { Write-Host "OK   claimB1 totalClaimedAmount=100" }

ExpectFail "vendor B is now fully claimed too (before cancel)" 400 { Invoke-RestMethod -Uri "$base/warranty-claims/aggregate" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ supplier = $supplierB; periodStart = $periodStart; periodEnd = $periodEnd } | ConvertTo-Json) }

$cancelledB1 = Step "cancel claimB1 (mistaken DRAFT)" { Invoke-RestMethod -Uri "$base/warranty-claims/$($claimB1.id)/cancel" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ reason = "Wrong period selected - re-aggregating" } | ConvertTo-Json) }
if ($cancelledB1.status -ne "CANCELLED") { Write-Host "FAIL: expected CANCELLED, got $($cancelledB1.status)" } else { Write-Host "OK   claimB1 status is CANCELLED" }

$claimB2 = Step "re-aggregate vendor B - the cancelled claim's reservation is claimable again" { Invoke-RestMethod -Uri "$base/warranty-claims/aggregate" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ supplier = $supplierB; periodStart = $periodStart; periodEnd = $periodEnd } | ConvertTo-Json) }
if ([decimal]$claimB2.totalClaimedAmount -ne 100) { Write-Host "FAIL: expected claimB2 totalClaimedAmount=100 (same reservation, reclaimed), got $($claimB2.totalClaimedAmount)" } else { Write-Host "OK   claimB2 totalClaimedAmount=100 - the-fool finding #3 verified live: cancel() actually frees the reservation" }

ExpectFail "cancel a SUBMITTED claim is blocked (only DRAFT can be cancelled)" 400 {
  $tmp = Invoke-RestMethod -Uri "$base/warranty-claims/$($claimB2.id)/submit" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ claimReferenceNumber = "VENDOR-B-TMP-$suffix" } | ConvertTo-Json)
  Invoke-RestMethod -Uri "$base/warranty-claims/$($claimB2.id)/cancel" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ reason = "too late" } | ConvertTo-Json)
}
$claimB2 = Step "confirm claimB2 is SUBMITTED (left submitted by the block above)" { Invoke-RestMethod -Uri "$base/warranty-claims/$($claimB2.id)" -Headers $H }
if ($claimB2.status -ne "SUBMITTED") { Write-Host "FAIL: expected claimB2 SUBMITTED, got $($claimB2.status)" } else { Write-Host "OK   claimB2 status is SUBMITTED" }

# ============================================================================
# 7. Submit (BRD 12.3) - vendor A
# ============================================================================
ExpectFail "field tech cannot submit (403)" 403 { Invoke-RestMethod -Uri "$base/warranty-claims/$($claimA.id)/submit" -Method Post -Headers $Hfield -ContentType "application/json" -Body (@{ claimReferenceNumber = "X" } | ConvertTo-Json) }
$submittedA = Step "warranty clerk submits claimA (BRD 12.3)" { Invoke-RestMethod -Uri "$base/warranty-claims/$($claimA.id)/submit" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ claimReferenceNumber = "VENDOR-CLM-$suffix"; notes = "Invoices attached in vendor portal" } | ConvertTo-Json) }
if ($submittedA.status -ne "SUBMITTED") { Write-Host "FAIL: expected SUBMITTED, got $($submittedA.status)" } else { Write-Host "OK   claimA status is SUBMITTED" }
if ($submittedA.claimReferenceNumber -ne "VENDOR-CLM-$suffix") { Write-Host "FAIL: claimReferenceNumber not recorded" } else { Write-Host "OK   claimReferenceNumber recorded" }
ExpectFail "re-submitting an already-SUBMITTED claim (400)" 400 { Invoke-RestMethod -Uri "$base/warranty-claims/$($claimA.id)/submit" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ claimReferenceNumber = "AGAIN" } | ConvertTo-Json) }

# ============================================================================
# 8. Credit note + GL posting (BRD 12.4) - partial recovery on vendor A (450 of 500)
# ============================================================================
ExpectFail "warranty clerk cannot record a credit note (403 - not a credit-note role)" 403 { Invoke-RestMethod -Uri "$base/warranty-claims/$($claimA.id)/credit-note" -Method Post -Headers $Hclerk -ContentType "application/json" -Body (@{ creditNoteNumber = "CN-1"; creditNoteAmount = 450 } | ConvertTo-Json) }
$creditedA = Step "accountant records vendor A's credit note (partial recovery)" { Invoke-RestMethod -Uri "$base/warranty-claims/$($claimA.id)/credit-note" -Method Post -Headers $Hacct -ContentType "application/json" -Body (@{ creditNoteNumber = "CN-2026-$suffix"; creditNoteAmount = 450 } | ConvertTo-Json) }
if ($creditedA.status -ne "CREDIT_RECEIVED") { Write-Host "FAIL: expected CREDIT_RECEIVED, got $($creditedA.status)" } else { Write-Host "OK   claimA status is CREDIT_RECEIVED" }
if ([decimal]$creditedA.creditNoteAmount -ne 450) { Write-Host "FAIL: expected creditNoteAmount=450, got $($creditedA.creditNoteAmount)" } else { Write-Host "OK   creditNoteAmount=450 (partial recovery)" }
ExpectFail "recording a credit note twice (400)" 400 { Invoke-RestMethod -Uri "$base/warranty-claims/$($claimA.id)/credit-note" -Method Post -Headers $Hacct -ContentType "application/json" -Body (@{ creditNoteNumber = "CN-AGAIN"; creditNoteAmount = 1 } | ConvertTo-Json) }

$glPostings = Step "check GL postings for WARRANTY_CLAIM_CREDIT" { Invoke-RestMethod -Uri "$base/gl-postings?sourceType=WARRANTY_CLAIM_CREDIT" -Headers $H }
$ourPosting = $glPostings | Where-Object { $_.sourceId -eq $claimA.id }
if (-not $ourPosting) { Write-Host "FAIL: no GL posting found for claimA" }
elseif (([decimal]$ourPosting.amount) -ne 450) { Write-Host "FAIL: GL posting amount is $($ourPosting.amount), expected 450" }
elseif ($ourPosting.debitAccount -notmatch "VENDOR-PAYABLE" -or $ourPosting.creditAccount -notmatch "WARRANTY-RECOVERY") { Write-Host "FAIL: GL posting accounts wrong - debit=$($ourPosting.debitAccount) credit=$($ourPosting.creditAccount)" }
else { Write-Host "OK   GL posting found: Debit $($ourPosting.debitAccount) / Credit $($ourPosting.creditAccount), amount=$($ourPosting.amount)" }

# ============================================================================
# 9. Recovery rate (BRD 12.5, the-fool finding #4)
# ============================================================================
$rateA = Step "recovery-rate for vendor A: 450/500 = 90%" { Invoke-RestMethod -Uri "$base/warranty-claims/recovery-rate?supplier=$([uri]::EscapeDataString($supplierA))" -Headers $Hacct }
if ([decimal]$rateA.totalClaimed -ne 500) { Write-Host "FAIL: vendor A totalClaimed expected 500, got $($rateA.totalClaimed)" } else { Write-Host "OK   vendor A totalClaimed=500" }
if ([decimal]$rateA.totalRecovered -ne 450) { Write-Host "FAIL: vendor A totalRecovered expected 450, got $($rateA.totalRecovered)" } else { Write-Host "OK   vendor A totalRecovered=450" }
if ([decimal]$rateA.rate -ne 90) { Write-Host "FAIL: vendor A rate expected 90, got $($rateA.rate)" } else { Write-Host "OK   vendor A rate=90%" }

$rateB = Step "recovery-rate for vendor B: SUBMITTED but no credit note yet -> 0%, not null (a real submitted claim counts in the denominator)" { Invoke-RestMethod -Uri "$base/warranty-claims/recovery-rate?supplier=$([uri]::EscapeDataString($supplierB))" -Headers $Hacct }
if ([decimal]$rateB.totalClaimed -ne 100) { Write-Host "FAIL: vendor B totalClaimed expected 100, got $($rateB.totalClaimed)" } else { Write-Host "OK   vendor B totalClaimed=100" }
if ([decimal]$rateB.totalRecovered -ne 0) { Write-Host "FAIL: vendor B totalRecovered expected 0, got $($rateB.totalRecovered)" } else { Write-Host "OK   vendor B totalRecovered=0" }
if ([decimal]$rateB.rate -ne 0) { Write-Host "FAIL: vendor B rate expected 0, got $($rateB.rate)" } else { Write-Host "OK   vendor B rate=0%" }

$rateNobody = Step "recovery-rate for a vendor with nothing claimed at all -> rate is null" { Invoke-RestMethod -Uri "$base/warranty-claims/recovery-rate?supplier=$([uri]::EscapeDataString("WC-Vendor-Nobody-$suffix"))" -Headers $Hacct }
if ($null -ne $rateNobody.rate) { Write-Host "FAIL: expected rate=null when nothing is claimed, got $($rateNobody.rate)" } else { Write-Host "OK   rate is null when the denominator is zero" }

Write-Host ""
Write-Host "=== Warranty Claims E2E test complete ==="
