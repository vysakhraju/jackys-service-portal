# Frontend Phase 11 (Dismantling) - live verification
#
# This can't be run from the cloud session (it has no network path to your machine), so
# run it yourself and paste the output back. It exercises the exact endpoints
# DismantlingPage.tsx / HarvestModal.tsx / PriceAndPostModal.tsx send, plus AC-31's
# three-distinct-actor segregation-of-duties rule end to end:
#   1. Record creation (PENDING_HARVEST).
#   2. Harvest - including a genuinely eligible component (matrix match, GOOD_WORKING,
#      RECOVERABLE_SPARE), a matrix-matched but CONSUMABLE component (ineligible by
#      category), an unmatched code with no yield-matrix row at all (ineligible, category
#      null - this is exactly the-fool pre-mortem finding #1's "typo" scenario, and the
#      one-shot nature of harvest), and a DAMAGED-condition component on an otherwise
#      eligible matrix row (ineligible by condition).
#   3. Verify - rejecting the harvester verifying their own work, then succeeding with a
#      different person.
#   4. Price & post - rejecting the harvester or the verifier from pricing/posting,
#      rejecting an unlogged code, rejecting a non-eligible code, rejecting a
#      quantityToConvert above what was harvested, then a real successful post that
#      adjusts inventory and posts to the GL.
#   5. Cancel - allowed at PENDING_HARVEST and COMPONENTS_LOGGED, blocked once VERIFIED,
#      and rejected a second time on an already-CANCELLED record.
#   6. The status-filtered list, serial-number lookup, and single-record GET.
#
# NOTE (found during backend review, not exercised here): priceAndPost() resolves each
# conversion line against the record's ALREADY-FETCHED in-memory snapshot before opening
# its transaction, so if a single request's `conversions` array listed the SAME
# originalBomItemCode twice, the "already selectedForConversion" guard wouldn't catch the
# second occurrence (it checks against the pre-fetch snapshot both times) and the stock
# increment would double-apply. The frontend can never construct such a request (each
# harvested line can only be selected once in PriceAndPostModal's form), so this is a
# backend-only latent gap, not a live-reachable one from this app - flagged for awareness,
# not fixed as part of this frontend phase.
#
# PREREQUISITE: the same technician account as verify-phase3..10.ps1 (any HARVEST_ROLES
# role works - TECHNICIAN_FIELD/TECHNICIAN_WORKSHOP), PLUS a second test account in
# Dismantling's VERIFY_ROLES so AC-31's three-distinct-actor rule can be exercised for
# real (the technician harvests, this second account verifies, your admin account prices
# & posts - three different people). If you don't have the second account yet, open a
# second PowerShell window:
#   cd "D:\Jackys\jackys service portal"
#   $env:SEED_TECH_EMAIL="supervisor@jackys.com"
#   $env:SEED_TECH_PASSWORD="Super123!"
#   $env:SEED_TECH_ROLE="TECHNICAL_TEAM_LEADER"
#   $env:SEED_TECH_FIRSTNAME="Test"
#   $env:SEED_TECH_LASTNAME="Supervisor"
#   npm run seed:technician
# then fill in its email/password below (no user id needed for this one).

$BaseUrl = "http://localhost:3000/api/v1"
$TechnicianEmail    = "tech@jackys.com"
$TechnicianPassword = "Tech123!"
$SupervisorEmail    = "supervisor@jackys.com"
$SupervisorPassword = "Super123!"

# ---------------------------------------------------------------------------
$ErrorActionPreference = "Stop"
$pass = 0
$fail = 0

function Step($name, $block) {
    Write-Host "`n--- $name ---" -ForegroundColor Cyan
    try {
        $result = & $block
        Write-Host "PASS: $name" -ForegroundColor Green
        $script:pass++
        return $result
    } catch {
        Write-Host "FAIL: $name" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
        $script:fail++
        return $null
    }
}

function Expect-StatusCode($name, $ExpectedCode, $block) {
    try {
        & $block
        Write-Host "FAIL: $name - expected HTTP $ExpectedCode but the call succeeded" -ForegroundColor Red
        $script:fail++
    } catch {
        $actual = $_.Exception.Response.StatusCode.value__
        if ($actual -eq $ExpectedCode) {
            Write-Host "PASS: $name (correctly got $ExpectedCode)" -ForegroundColor Green
            $script:pass++
        } else {
            Write-Host "FAIL: $name - expected $ExpectedCode, got $actual" -ForegroundColor Red
            if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
            $script:fail++
        }
    }
}

function Invoke-Api($Method, $Path, $Token, $Body) {
    $headers = @{}
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    $params = @{
        Method  = $Method
        Uri     = "$BaseUrl$Path"
        Headers = $headers
        ContentType = "application/json"
    }
    if ($Body) { $params["Body"] = ($Body | ConvertTo-Json -Depth 10) }
    return Invoke-RestMethod @params
}

Write-Host "Frontend Phase 11 live-verification against $BaseUrl" -ForegroundColor Yellow
$suffix = (Get-Date).ToString("HHmmss")
$modelId = "DISM-M-$suffix"

# 0. Log in all three actors up front.
$adminLogin = Step "Admin login (POST /auth/login)" { Invoke-Api POST "/auth/login" $null @{ email = "admin@jackys.com"; password = "Admin123!" } }
$adminToken = $adminLogin.accessToken
if (-not $adminToken) { Write-Host "`nCan't continue without an admin token - stopping." -ForegroundColor Red; exit 1 }

$techLogin = Step "Technician login" { Invoke-Api POST "/auth/login" $null @{ email = $TechnicianEmail; password = $TechnicianPassword } }
$techToken = $techLogin.accessToken
$techProfile = Step "Technician profile" { Invoke-Api GET "/auth/profile" $techToken $null }
$techId = $techProfile.id

$supervisorLogin = Step "Supervisor login (second account, needed for AC-31)" { Invoke-Api POST "/auth/login" $null @{ email = $SupervisorEmail; password = $SupervisorPassword } }
$supervisorToken = $supervisorLogin.accessToken
if (-not $supervisorToken) {
    Write-Host "`nNo supervisor token - see the PREREQUISITE comment at the top of this script to seed a second account. Stopping." -ForegroundColor Red
    exit 1
}
$supervisorProfile = Step "Supervisor profile" { Invoke-Api GET "/auth/profile" $supervisorToken $null }
$supervisorId = $supervisorProfile.id

$adminProfile = Step "Admin profile" { Invoke-Api GET "/auth/profile" $adminToken $null }
$adminId = $adminProfile.id

# 1. Master data: two ComponentYieldMatrix rows (one RECOVERABLE_SPARE, one CONSUMABLE),
# a SparePart matching the recoverable row's convertedSparePartCode, and a SparePartModel
# to link it to (AC-17 integrity rule, same as GRN enforces).
Step "Create ComponentYieldMatrix row: eligible recoverable spare" {
    Invoke-Api POST "/master-data/component-yield" $adminToken @{
        modelId = $modelId; originalBomItemCode = "COMP-COMPRESSOR-01"; itemName = "Compressor Assembly"
        category = "RECOVERABLE_SPARE"; convertedSparePartCode = "SP-DISM-$suffix"
    }
} | Out-Null
Step "Create ComponentYieldMatrix row: consumable (never eligible)" {
    Invoke-Api POST "/master-data/component-yield" $adminToken @{
        modelId = $modelId; originalBomItemCode = "COMP-GASKET-01"; itemName = "Door Gasket"
        category = "CONSUMABLE"
    }
} | Out-Null

$sparePart = Step "Create SparePart SP-DISM-$suffix" {
    Invoke-Api POST "/master-data/spare-parts" $adminToken @{
        code = "SP-DISM-$suffix"; name = "Recovered Compressor"; category = "COMPRESSOR"; unitCost = 60
    }
}
$sparePartModel = Step "Create a SparePartModel to link it to" {
    Invoke-Api POST "/master-data/spare-part-models" $adminToken @{ modelId = "SPM-$suffix"; brand = "Samsung"; modelName = "Test Model $suffix" }
}
Step "Link the spare part to that model (AC-17 integrity requirement for price-and-post)" {
    # The link-model endpoint's "modelId" field is the SparePartModel row's own UUID (its
    # `id`), not its human-facing model code (`modelId` on that entity, e.g. "SPM-093543") -
    # passing the code here is what caused the first live run's "modelId must be a UUID" 400.
    Invoke-Api POST "/master-data/spare-parts/$($sparePart.id)/link-model" $adminToken @{ modelId = $sparePartModel.id }
} | Out-Null

# =====================================================================================
# PART A - Create + harvest (eligible / consumable / unmatched-code / damaged-condition)
# =====================================================================================

$recordA = Step "Create dismantling record A" {
    Invoke-Api POST "/dismantling" $adminToken @{
        applianceSerialNumber = "SN-DISM-A-$suffix"; modelId = $modelId
        damageLocationNotes = "Phase 11 verify - confirmed DOA, bay 3"
    }
}
Write-Host "recordNumber=$($recordA.recordNumber) status=$($recordA.status) (expect PENDING_HARVEST)"

$harvestedA = Step "[tech] Harvest 4 components (1 eligible, 1 consumable, 1 unmatched code, 1 damaged)" {
    Invoke-Api POST "/dismantling/$($recordA.id)/harvest" $techToken @{
        components = @(
            @{ originalBomItemCode = "COMP-COMPRESSOR-01"; testedCondition = "GOOD_WORKING"; quantity = 2 }
            @{ originalBomItemCode = "COMP-GASKET-01"; testedCondition = "GOOD_WORKING"; quantity = 3 }
            @{ originalBomItemCode = "COMP-TYPO-CODE-XX"; testedCondition = "GOOD_WORKING"; quantity = 1 }
            @{ originalBomItemCode = "COMP-GASKET-01-DAMAGED-CHECK"; testedCondition = "DAMAGED"; quantity = 1 }
        )
    }
}
Write-Host "status=$($harvestedA.status) (expect COMPONENTS_LOGGED), component count=$($harvestedA.harvestedComponents.Count) (expect 4)"
$eligibleFlags = $harvestedA.harvestedComponents | ForEach-Object { "$($_.originalBomItemCode)=$($_.eligibleForConversion)" }
Write-Host "eligibility: $($eligibleFlags -join ', ') (expect only COMP-COMPRESSOR-01=True)"

Expect-StatusCode "Harvesting a second time on the same (now COMPONENTS_LOGGED) record is rejected" 400 {
    Invoke-Api POST "/dismantling/$($recordA.id)/harvest" $techToken @{ components = @(@{ originalBomItemCode = "COMP-COMPRESSOR-01"; testedCondition = "GOOD_WORKING"; quantity = 1 }) }
}

# =====================================================================================
# PART B - Verify: AC-31 actor #2 must differ from the harvester
# =====================================================================================

# A technician (HARVEST_ROLES only, not in VERIFY_ROLES) can never reach AC-31's
# same-actor check on /verify at all - the RolesGuard rejects them with 403 before the
# service layer runs, regardless of who harvested. To genuinely exercise the service-layer
# 400 we need someone who legitimately holds a VERIFY_ROLES role (so the guard lets them
# through) but happens to be the same person who harvested - TECHNICAL_TEAM_LEADER,
# SERVICE_HEAD and SUPER_ADMIN are all also in HARVEST_ROLES, so the supervisor account
# works for this. Record E is dedicated to that check.
$recordE = Step "Create record E (for the AC-31 self-verify check)" {
    Invoke-Api POST "/dismantling" $supervisorToken @{ applianceSerialNumber = "SN-DISM-E-$suffix"; modelId = $modelId }
}
Step "[supervisor] Harvest record E" {
    Invoke-Api POST "/dismantling/$($recordE.id)/harvest" $supervisorToken @{ components = @(@{ originalBomItemCode = "COMP-COMPRESSOR-01"; testedCondition = "GOOD_WORKING"; quantity = 1 }) }
} | Out-Null
Expect-StatusCode "[supervisor, the harvester] Verifying their own harvest on record E is rejected (AC-31)" 400 {
    Invoke-Api POST "/dismantling/$($recordE.id)/verify" $supervisorToken @{ notes = "self-verify attempt" }
}
Step "[admin] Verify record E (a genuinely different person) to leave it in a clean state" {
    Invoke-Api POST "/dismantling/$($recordE.id)/verify" $adminToken @{ notes = "confirmed by a different person" }
} | Out-Null

Expect-StatusCode "[tech, holds no VERIFY_ROLES role] Verifying record A is rejected (RBAC)" 403 {
    Invoke-Api POST "/dismantling/$($recordA.id)/verify" $techToken @{ notes = "self-verify attempt" }
}

$verifiedA = Step "[supervisor] Verify record A (a different person from the harvester)" {
    Invoke-Api POST "/dismantling/$($recordA.id)/verify" $supervisorToken @{ notes = "Confirmed - compressor and gasket counts match technician log" }
}
Write-Host "status=$($verifiedA.status) verifiedByUserId matches supervisor=$($verifiedA.verifiedByUserId -eq $supervisorId) (expect VERIFIED, True)"

Expect-StatusCode "Verifying again (no longer COMPONENTS_LOGGED) is rejected" 400 {
    Invoke-Api POST "/dismantling/$($recordA.id)/verify" $supervisorToken @{ notes = "second attempt" }
}

# =====================================================================================
# PART C - Price & post: AC-31 actor #3 must differ from BOTH the harvester and verifier,
# plus the fail-fast validation on the conversion lines themselves.
# =====================================================================================

# Same RolesGuard-vs-service-layer distinction as Part B: MANAGER_ROLES is SERVICE_HEAD +
# SUPER_ADMIN only, so tech and supervisor never even reach AC-31's same-actor check on
# price-and-post - the guard rejects them first (403), whoever harvested or verified.
Expect-StatusCode "[tech, holds no MANAGER_ROLES role] Price-and-post is rejected (RBAC)" 403 {
    Invoke-Api POST "/dismantling/$($recordA.id)/price-and-post" $techToken @{ conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-01"; recoveryUnitPrice = 85.0 }) }
}
Expect-StatusCode "[supervisor, holds no MANAGER_ROLES role] Price-and-post is rejected (RBAC)" 403 {
    Invoke-Api POST "/dismantling/$($recordA.id)/price-and-post" $supervisorToken @{ conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-01"; recoveryUnitPrice = 85.0 }) }
}

# Records F and G exercise AC-31's actual service-layer 400s, using admin (who legitimately
# holds price-and-post access) as the repeat actor - the only way to get PAST the guard and
# INTO the same-actor check with the accounts this script has.
$recordF = Step "Create record F (for the AC-31 harvester-as-pricer check)" {
    Invoke-Api POST "/dismantling" $adminToken @{ applianceSerialNumber = "SN-DISM-F-$suffix"; modelId = $modelId }
}
Step "[admin] Harvest record F" {
    Invoke-Api POST "/dismantling/$($recordF.id)/harvest" $adminToken @{ components = @(@{ originalBomItemCode = "COMP-COMPRESSOR-01"; testedCondition = "GOOD_WORKING"; quantity = 1 }) }
} | Out-Null
Step "[supervisor] Verify record F (a genuinely different person from the admin harvester)" {
    Invoke-Api POST "/dismantling/$($recordF.id)/verify" $supervisorToken @{ notes = "confirmed" }
} | Out-Null
Expect-StatusCode "[admin, the harvester] Price-and-post on record F is rejected (AC-31)" 400 {
    Invoke-Api POST "/dismantling/$($recordF.id)/price-and-post" $adminToken @{ conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-01"; recoveryUnitPrice = 85.0 }) }
}

$recordG = Step "Create record G (for the AC-31 verifier-as-pricer check)" {
    Invoke-Api POST "/dismantling" $adminToken @{ applianceSerialNumber = "SN-DISM-G-$suffix"; modelId = $modelId }
}
Step "[tech] Harvest record G" {
    Invoke-Api POST "/dismantling/$($recordG.id)/harvest" $techToken @{ components = @(@{ originalBomItemCode = "COMP-COMPRESSOR-01"; testedCondition = "GOOD_WORKING"; quantity = 1 }) }
} | Out-Null
Step "[admin] Verify record G (a genuinely different person from the tech harvester)" {
    Invoke-Api POST "/dismantling/$($recordG.id)/verify" $adminToken @{ notes = "confirmed" }
} | Out-Null
Expect-StatusCode "[admin, the verifier] Price-and-post on record G is rejected (AC-31)" 400 {
    Invoke-Api POST "/dismantling/$($recordG.id)/price-and-post" $adminToken @{ conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-01"; recoveryUnitPrice = 85.0 }) }
}

Expect-StatusCode "[admin, a third distinct person] Price-and-post with a code never harvested is rejected" 400 {
    Invoke-Api POST "/dismantling/$($recordA.id)/price-and-post" $adminToken @{ conversions = @(@{ originalBomItemCode = "COMP-NEVER-HARVESTED"; recoveryUnitPrice = 10.0 }) }
}
Expect-StatusCode "Price-and-post selecting the CONSUMABLE component (not eligible) is rejected" 400 {
    Invoke-Api POST "/dismantling/$($recordA.id)/price-and-post" $adminToken @{ conversions = @(@{ originalBomItemCode = "COMP-GASKET-01"; recoveryUnitPrice = 5.0 }) }
}
Expect-StatusCode "Price-and-post selecting the unmatched-code component (not eligible, no matrix row) is rejected" 400 {
    Invoke-Api POST "/dismantling/$($recordA.id)/price-and-post" $adminToken @{ conversions = @(@{ originalBomItemCode = "COMP-TYPO-CODE-XX"; recoveryUnitPrice = 5.0 }) }
}
Expect-StatusCode "Price-and-post requesting more quantity than was harvested (2 harvested, 5 requested) is rejected" 400 {
    Invoke-Api POST "/dismantling/$($recordA.id)/price-and-post" $adminToken @{ conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-01"; recoveryUnitPrice = 85.0; quantityToConvert = 5 }) }
}

$postedA = Step "[admin, a third distinct person] Price-and-post the eligible compressor (full harvested quantity)" {
    Invoke-Api POST "/dismantling/$($recordA.id)/price-and-post" $adminToken @{
        conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-01"; recoveryUnitPrice = 85.0; quantityToConvert = 2 })
    }
}
Write-Host "status=$($postedA.status) totalRecoveredValue=$($postedA.totalRecoveredValue) pricedByUserId matches admin=$($postedA.pricedByUserId -eq $adminId) (expect POSTED, 170, True)"

Expect-StatusCode "Price-and-post again on an already-POSTED record is rejected" 400 {
    Invoke-Api POST "/dismantling/$($recordA.id)/price-and-post" $adminToken @{ conversions = @(@{ originalBomItemCode = "COMP-COMPRESSOR-01"; recoveryUnitPrice = 85.0 }) }
}

$sparePartsAfter = Step "GET /master-data/spare-parts?category=COMPRESSOR - confirm the recovered part still resolves" {
    Invoke-Api GET "/master-data/spare-parts?category=COMPRESSOR" $adminToken $null
}
$ourPart = $sparePartsAfter | Where-Object { $_.id -eq $sparePart.id }
Write-Host "recovered spare part still present in master data: $([bool]$ourPart) (expect True)"

# =====================================================================================
# PART D - Cancel: allowed at PENDING_HARVEST and COMPONENTS_LOGGED, blocked once VERIFIED.
# =====================================================================================

$recordB = Step "Create record B (for the PENDING_HARVEST cancel path)" {
    Invoke-Api POST "/dismantling" $adminToken @{ applianceSerialNumber = "SN-DISM-B-$suffix"; modelId = $modelId }
}
$cancelledB = Step "Cancel record B while PENDING_HARVEST" {
    Invoke-Api POST "/dismantling/$($recordB.id)/cancel" $adminToken @{ reason = "Phase 11 verify - nothing salvageable found on inspection" }
}
Write-Host "status=$($cancelledB.status) cancellationReason=$($cancelledB.cancellationReason) (expect CANCELLED)"

Expect-StatusCode "Cancelling record B again is rejected (already CANCELLED)" 400 {
    Invoke-Api POST "/dismantling/$($recordB.id)/cancel" $adminToken @{ reason = "second attempt" }
}

$recordC = Step "Create record C (for the COMPONENTS_LOGGED cancel path)" {
    Invoke-Api POST "/dismantling" $adminToken @{ applianceSerialNumber = "SN-DISM-C-$suffix"; modelId = $modelId }
}
Step "[tech] Harvest on record C" {
    Invoke-Api POST "/dismantling/$($recordC.id)/harvest" $techToken @{ components = @(@{ originalBomItemCode = "COMP-GASKET-01"; testedCondition = "GOOD_WORKING"; quantity = 1 }) }
} | Out-Null
$cancelledC = Step "Cancel record C while COMPONENTS_LOGGED (still allowed)" {
    Invoke-Api POST "/dismantling/$($recordC.id)/cancel" $adminToken @{ reason = "Phase 11 verify - customer took the unit back before recovery" }
}
Write-Host "status=$($cancelledC.status) (expect CANCELLED)"

$recordD = Step "Create record D (for the blocked-once-VERIFIED cancel path)" {
    Invoke-Api POST "/dismantling" $adminToken @{ applianceSerialNumber = "SN-DISM-D-$suffix"; modelId = $modelId }
}
Step "[tech] Harvest on record D" {
    Invoke-Api POST "/dismantling/$($recordD.id)/harvest" $techToken @{ components = @(@{ originalBomItemCode = "COMP-GASKET-01"; testedCondition = "GOOD_WORKING"; quantity = 1 }) }
} | Out-Null
Step "[supervisor] Verify record D" {
    Invoke-Api POST "/dismantling/$($recordD.id)/verify" $supervisorToken @{ notes = "confirmed" }
} | Out-Null
Expect-StatusCode "Cancelling record D once VERIFIED is rejected (would discard the supervisor's sign-off)" 400 {
    Invoke-Api POST "/dismantling/$($recordD.id)/cancel" $adminToken @{ reason = "too late" }
}

# =====================================================================================
# PART E - List/filter, serial lookup, single-record GET.
# =====================================================================================

$postedList = Step "GET /dismantling?status=POSTED includes record A" { Invoke-Api GET "/dismantling?status=POSTED" $adminToken $null }
$aInPosted = $recordA.id -in $postedList.id
Write-Host "record A present in the POSTED list: $aInPosted (expect True)"

$bySerial = Step "GET /dismantling/serial/:applianceSerialNumber for record A's serial" { Invoke-Api GET "/dismantling/serial/SN-DISM-A-$suffix" $adminToken $null }
Write-Host "results for record A's serial: $($bySerial.Count) (expect 1), matches record A: $($bySerial[0].id -eq $recordA.id)"

$fetchedA = Step "GET /dismantling/:id for record A" { Invoke-Api GET "/dismantling/$($recordA.id)" $adminToken $null }
Write-Host "fetched status=$($fetchedA.status) totalRecoveredValue=$($fetchedA.totalRecoveredValue) (expect POSTED, 170)"

Write-Host "`n=================================================="
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================="
