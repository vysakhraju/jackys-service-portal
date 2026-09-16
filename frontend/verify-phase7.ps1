# Frontend Phase 7 (QC + Permissions admin) - live verification
#
# This can't be run from the cloud session (it has no network path to your machine), so
# run it yourself and paste the output back. It exercises the exact endpoints QcPage.tsx /
# PermissionsPage.tsx send - qc/approve happy path, the per-spare-part stock-shortfall 409
# (the-fool pre-mortem finding #2 - a masked shortfall from an unrelated part's request),
# qc/reject, and the full grant/revoke/list-by-type/list-by-user permissions lifecycle -
# nothing here is invented.
#
# PREREQUISITE: a technician test account, same as verify-phase3/4/5/6.ps1. If you already
# have one, fill in its email/password/id below. If not, open a second PowerShell window:
#   cd "D:\Jackys\jackys service portal"
#   npm run seed:technician
# then copy the printed email/password/user id into the three lines below.

$BaseUrl = "http://localhost:3000/api/v1"
$TechnicianEmail    = "tech@jackys.com"
$TechnicianPassword = "Tech123!"
$TechnicianId       = "6cbfe09b-2673-4db7-b9e9-4d9d1fdcf8be"

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

# Builds one job card from a fresh WARRANTY appointment through to WORKSHOP_ASSIGNED +
# IN_PROGRESS, ready for request-spare/complete calls - same lifecycle verify-phase6.ps1
# uses, factored out here since this script needs it three times. Each call is still
# individually Step-wrapped so a failure partway through is visible and doesn't silently
# skip later assertions.
function New-WorkshopJobCard($serviceCentreId, $faultCode, $symptomCode, $serialNumber, $label) {
    $appt = Step "[$label] Create WARRANTY appointment" {
        Invoke-Api POST "/appointments" $adminToken @{
            type = "WARRANTY"; customerType = "B2C"
            customerName = "Phase 7 Test Customer"; customerPhone = "+971509990000"; customerEmail = "phase7-$label@example.com"
            brand = "Samsung"; modelNumber = "WA80J5710"; serialNumber = $serialNumber
            problemDescription = "Phase 7 test issue ($label)"
            invoiceNumber = "INV-PH7-$label"
            scheduledAt = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
            serviceCentreId = $serviceCentreId
        }
    }
    $apptId = $appt.id
    Step "[$label] Confirm appointment" { Invoke-Api PUT "/appointments/$apptId/confirm" $adminToken $null } | Out-Null
    Step "[$label] Assign technician" { Invoke-Api PUT "/appointments/$apptId/assign-technician" $adminToken @{ technicianId = $TechnicianId } } | Out-Null
    Step "[$label] Start visit" { Invoke-Api POST "/technician/visits/$apptId/start" $script:techToken @{ gpsLat = 25.2048; gpsLng = 55.2708 } } | Out-Null
    Step "[$label] Capture serial number" { Invoke-Api POST "/technician/visits/$apptId/serial-number" $script:techToken @{ serialNumber = $serialNumber; brand = "Samsung" } } | Out-Null
    Step "[$label] Capture fault/symptom" { Invoke-Api POST "/technician/visits/$apptId/fault-symptom" $script:techToken @{ faultCode = $faultCode; symptomCode = $symptomCode } } | Out-Null
    Step "[$label] Complete appointment" { Invoke-Api PUT "/appointments/$apptId/complete" $script:techToken $null } | Out-Null
    $jc = Step "[$label] Create Job Card" { Invoke-Api POST "/job-cards" $adminToken @{ appointmentId = $apptId } }
    $jobCardId = $jc.id
    Step "[$label] Validate S/N" { Invoke-Api POST "/job-cards/$jobCardId/validate-sn" $adminToken @{ matches = $true } } | Out-Null
    Step "[$label] Assign section = WORKSHOP" { Invoke-Api POST "/job-cards/$jobCardId/assign-section" $adminToken @{ section = "WORKSHOP" } } | Out-Null
    Step "[$label] Assign workshop technician" { Invoke-Api POST "/workshop/$jobCardId/assign" $adminToken @{ technicianId = $TechnicianId } } | Out-Null
    Step "[$label] Start WIP" { Invoke-Api POST "/workshop/$jobCardId/start-wip" $adminToken $null } | Out-Null
    return $jobCardId
}

Write-Host "Frontend Phase 7 live-verification against $BaseUrl" -ForegroundColor Yellow
$suffix = (Get-Date).ToString("HHmmss")

# 1. Admin login + self-grant QC_APPROVAL (idempotent - same as verify-phase6.ps1, since a
# second run hitting the already-granted 409 is expected, not a real failure).
$adminLogin = Step "Admin login (POST /auth/login)" { Invoke-Api POST "/auth/login" $null @{ email = "admin@jackys.com"; password = "Admin123!" } }
$adminToken = $adminLogin.accessToken
if (-not $adminToken) { Write-Host "`nCan't continue without an admin token - stopping." -ForegroundColor Red; exit 1 }
$adminProfile = Step "Admin profile (GET /auth/profile)" { Invoke-Api GET "/auth/profile" $adminToken $null }
$adminUserId = $adminProfile.id

Write-Host "`n--- Grant admin the QC_APPROVAL permission (POST /permissions/grant) ---" -ForegroundColor Cyan
try {
    Invoke-Api POST "/permissions/grant" $adminToken @{ userId = $adminUserId; permissionType = "QC_APPROVAL"; notes = "Phase 7 verify script" } | Out-Null
    Write-Host "PASS: granted QC_APPROVAL to admin" -ForegroundColor Green
    $pass++
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 409) {
        Write-Host "PASS: admin already holds QC_APPROVAL from a previous run (409, expected on reruns)" -ForegroundColor Green
        $pass++
    } else {
        Write-Host "FAIL: Grant admin the QC_APPROVAL permission" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        $fail++
    }
}

$techLogin = Step "Technician login" { Invoke-Api POST "/auth/login" $null @{ email = $TechnicianEmail; password = $TechnicianPassword } }
$techToken = $techLogin.accessToken

# 2. Master data: one service centre, one wide warranty-master range covering every serial
# this script uses (so every visit below returns a real IN_WARRANTY badge), one
# fault/symptom, one model, and three spare parts (A: ample stock for the happy path; C:
# deliberately under-stocked; D: ample stock, used to mask C's shortfall - see step 5).
$centre = Step "Create service centre (POST /master-data/service-centres)" {
    Invoke-Api POST "/master-data/service-centres" $adminToken @{
        code = "PH7-$suffix"; name = "Phase 7 Verify Centre"; country = "UAE"; vatRate = 5
        schedule = @{
            monday    = @{ isOpen = $true;  startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            tuesday   = @{ isOpen = $true;  startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            wednesday = @{ isOpen = $true;  startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            thursday  = @{ isOpen = $true;  startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            friday    = @{ isOpen = $true;  startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            saturday  = @{ isOpen = $true;  startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            sunday    = @{ isOpen = $false; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 0 }
        }
    }
}
$serviceCentreId = $centre.id

Step "Create warranty master entry covering every serial this script uses (POST /master-data/warranty-master)" {
    Invoke-Api POST "/master-data/warranty-master" $adminToken @{
        serialNumberRange = "SN800000-SN809999"; brand = "Samsung"; model = "WA80J5710"
        warrantyPeriodMonths = 24; supplier = "Samsung Gulf"
    }
} | Out-Null

# Suffixed like every other test-data field in this script (fault/symptom codes are
# unique) - a hardcoded code here would 409 on a rerun, same fix applied to
# verify-phase6.ps1 after its own rerun hit exactly that.
$faultCode = "F-PH7-$suffix"
$symptomCode = "S-PH7-$suffix"
Step "Create fault/symptom (POST /master-data/fault-symptoms)" {
    Invoke-Api POST "/master-data/fault-symptoms" $adminToken @{
        faultCode = $faultCode; faultDescription = "Phase 7 test fault"
        symptomCode = $symptomCode; symptomDescription = "Phase 7 test symptom"
        category = "WASHING_MACHINE"
    }
} | Out-Null

$model = Step "Create spare part model (POST /master-data/spare-part-models)" {
    Invoke-Api POST "/master-data/spare-part-models" $adminToken @{ modelId = "PH7MODEL-$suffix"; brand = "Samsung"; modelName = "WA80J5710" }
}
$sparePartA = Step "Create spare part A - ample stock, happy path (POST /master-data/spare-parts)" {
    Invoke-Api POST "/master-data/spare-parts" $adminToken @{ code = "SP-PH7A-$suffix"; name = "Drum Bearing"; category = "MOTOR"; unitCost = 80 }
}
$sparePartAId = $sparePartA.id
$sparePartC = Step "Create spare part C - deliberately under-stocked (POST /master-data/spare-parts)" {
    Invoke-Api POST "/master-data/spare-parts" $adminToken @{ code = "SP-PH7C-$suffix"; name = "Control Board"; category = "ELECTRONIC"; unitCost = 220 }
}
$sparePartCId = $sparePartC.id
$sparePartD = Step "Create spare part D - ample stock, masks C's shortfall at job level (POST /master-data/spare-parts)" {
    Invoke-Api POST "/master-data/spare-parts" $adminToken @{ code = "SP-PH7D-$suffix"; name = "Door Latch"; category = "OTHER"; unitCost = 30 }
}
$sparePartDId = $sparePartD.id
Step "Link spare part A to the model" { Invoke-Api POST "/master-data/spare-parts/$sparePartAId/link-model" $adminToken @{ modelId = $model.id } } | Out-Null
Step "Link spare part C to the model" { Invoke-Api POST "/master-data/spare-parts/$sparePartCId/link-model" $adminToken @{ modelId = $model.id } } | Out-Null
Step "Link spare part D to the model" { Invoke-Api POST "/master-data/spare-parts/$sparePartDId/link-model" $adminToken @{ modelId = $model.id } } | Out-Null

Step "GRN: 5 units of A (POST /inventory/grn)" { Invoke-Api POST "/inventory/grn" $adminToken @{ sparePartId = $sparePartAId; quantity = 5; notes = "Phase 7 verify" } } | Out-Null
Step "GRN: only 2 units of C (deliberately short)" { Invoke-Api POST "/inventory/grn" $adminToken @{ sparePartId = $sparePartCId; quantity = 2; notes = "Phase 7 verify - deliberately short" } } | Out-Null
Step "GRN: 4 units of D" { Invoke-Api POST "/inventory/grn" $adminToken @{ sparePartId = $sparePartDId; quantity = 4; notes = "Phase 7 verify" } } | Out-Null

# 3. Happy path: one spare part, fully reserved, QC approves cleanly and stock moves
# Main Store -> Damage Location.
$jc1 = New-WorkshopJobCard $serviceCentreId $faultCode $symptomCode "SN800001" "happy"
$res1 = Step "[happy] Request 3 of 5 available units of A - expect HELD" { Invoke-Api POST "/workshop/$jc1/request-spare" $adminToken @{ sparePartId = $sparePartAId; quantity = 3 } }
Write-Host "status=$($res1.status) (expect HELD)"
$completed1 = Step "[happy] Complete workshop work (POST /workshop/:jobCardId/complete)" { Invoke-Api POST "/workshop/$jc1/complete" $adminToken $null }
Write-Host "status=$($completed1.status) (expect READY_FOR_QC)"
$stockBeforeApprove = Step "[happy] Stock lookup for A before approval (GET /inventory/stock/:sparePartId)" { Invoke-Api GET "/inventory/stock/$sparePartAId" $adminToken $null }
Write-Host "quantityOnHand=$($stockBeforeApprove.quantityOnHand) (expect 5, nothing consumed yet)"
$approved1 = Step "[happy] QC approve (POST /job-cards/:id/qc/approve)" { Invoke-Api POST "/job-cards/$jc1/qc/approve" $adminToken $null }
Write-Host "status=$($approved1.status) qcApprovedAt=$($approved1.qcApprovedAt) (expect QC_PASSED, timestamp set)"
$stockAfterApprove = Step "[happy] Stock lookup for A, Main Store, after approval" { Invoke-Api GET "/inventory/stock/$sparePartAId" $adminToken $null }
Write-Host "quantityOnHand=$($stockAfterApprove.quantityOnHand) (expect 2 = 5 - 3, consumed on approval)"
$damageStockAfterApprove = Step "[happy] Stock lookup for A, Damage Location, after approval (GET ?location=DAMAGE_LOCATION)" { Invoke-Api GET "/inventory/stock/$sparePartAId`?location=DAMAGE_LOCATION" $adminToken $null }
Write-Host "quantityOnHand=$($damageStockAfterApprove.quantityOnHand) (expect 3, moved off Main Store)"

Expect-StatusCode "[happy] A second qc/approve on an already-QC_PASSED job is rejected (expect 400)" 400 {
    Invoke-Api POST "/job-cards/$jc1/qc/approve" $adminToken $null
}

# 4. Shortfall path: C's last request comes back short (PARTIALLY_RESERVED); D's fully-held
# request afterward flips the job back to IN_PROGRESS at the JOB level even though C is
# still short at the PART level - the exact masked-shortfall gap the-fool pre-mortem
# finding #2 is about. qc/approve must still catch it per-part.
$jc2 = New-WorkshopJobCard $serviceCentreId $faultCode $symptomCode "SN800002" "shortfall"
$res2a = Step "[shortfall] Request 5 of only 2 available units of C - expect PARTIALLY_RESERVED" { Invoke-Api POST "/workshop/$jc2/request-spare" $adminToken @{ sparePartId = $sparePartCId; quantity = 5 } }
Write-Host "status=$($res2a.status) quantityReserved=$($res2a.quantityReserved)/$($res2a.quantityRequested) (expect PARTIALLY_RESERVED 2/5)"
$res2b = Step "[shortfall] Request 4 of 4 available units of D - expect HELD, masks the job-level status" { Invoke-Api POST "/workshop/$jc2/request-spare" $adminToken @{ sparePartId = $sparePartDId; quantity = 4 } }
Write-Host "status=$($res2b.status) (expect HELD)"
$stateAfterMask = Step "[shortfall] Job Card flips back to IN_PROGRESS (job-level check only sees D's success) (GET /workshop/:jobCardId)" { Invoke-Api GET "/workshop/$jc2" $adminToken $null }
Write-Host "jobCard.status=$($stateAfterMask.jobCard.status) (expect IN_PROGRESS, NOT SPARE_PENDING - C's shortfall is masked at the job level)"
$completed2 = Step "[shortfall] Complete workshop work succeeds because the job-level check is fooled" { Invoke-Api POST "/workshop/$jc2/complete" $adminToken $null }
Write-Host "status=$($completed2.status) (expect READY_FOR_QC)"

$approveAttempt2 = Step "[shortfall] QC approve is blocked with a structured 409 naming C's reservation (POST /job-cards/:id/qc/approve)" {
    try {
        Invoke-Api POST "/job-cards/$jc2/qc/approve" $adminToken $null
        throw "Expected a 409 but the call succeeded"
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw }
        $body = $_.ErrorDetails.Message | ConvertFrom-Json
        return $body
    }
}
if ($approveAttempt2) {
    $blocker = $approveAttempt2.blockers | Where-Object { $_.sparePartId -eq $sparePartCId }
    Write-Host "blockers.Count=$($approveAttempt2.blockers.Count) matching-C-blocker.quantityReserved=$($blocker.quantityReserved)/$($blocker.quantityRequested) (expect 1 blocker, 2/5)"
}

Step "[shortfall] GRN top-up: 3 more units of C (now 5 total on hand)" { Invoke-Api POST "/inventory/grn" $adminToken @{ sparePartId = $sparePartCId; quantity = 3; notes = "Phase 7 verify - resolving the shortfall" } } | Out-Null
$res2c = Step "[shortfall] Top-up request: remaining 3 units of C - expect HELD, resolves C's per-part shortfall" { Invoke-Api POST "/workshop/$jc2/request-spare" $adminToken @{ sparePartId = $sparePartCId; quantity = 3 } }
Write-Host "status=$($res2c.status) (expect HELD)"
$stateStillReady = Step "[shortfall] Job Card status is untouched by the READY_FOR_QC top-up (GET /workshop/:jobCardId)" { Invoke-Api GET "/workshop/$jc2" $adminToken $null }
Write-Host "jobCard.status=$($stateStillReady.jobCard.status) (expect still READY_FOR_QC)"
$approved2 = Step "[shortfall] QC approve now succeeds once every part's latest reservation is fully held" { Invoke-Api POST "/job-cards/$jc2/qc/approve" $adminToken $null }
Write-Host "status=$($approved2.status) (expect QC_PASSED)"

# 5. Reject path: no spares needed, straight IN_PROGRESS -> READY_FOR_QC -> reject.
$jc3 = New-WorkshopJobCard $serviceCentreId $faultCode $symptomCode "SN800003" "reject"
$completed3 = Step "[reject] Complete workshop work with no spares requested" { Invoke-Api POST "/workshop/$jc3/complete" $adminToken $null }
Write-Host "status=$($completed3.status) (expect READY_FOR_QC)"
Expect-StatusCode "[reject] qc/reject with a too-short reason is rejected (expect 400)" 400 {
    Invoke-Api POST "/job-cards/$jc3/qc/reject" $adminToken @{ reason = "no" }
}
$rejected3 = Step "[reject] QC reject with a valid reason (POST /job-cards/:id/qc/reject)" { Invoke-Api POST "/job-cards/$jc3/qc/reject" $adminToken @{ reason = "Phase 7 verify - door latch alignment still off" } }
Write-Host "status=$($rejected3.status) qcRejectionCount=$($rejected3.qcRejectionCount) (expect IN_PROGRESS / 1)"

# 6. Permissions lifecycle: grant/duplicate-grant/list-by-type/revoke/revoke-again, using
# the technician + REWORK_APPROVAL (kept separate from admin's own QC_APPROVAL grant above
# so this section doesn't disturb what steps 3-5 depend on).
Write-Host "`n--- Cleanup: clear any leftover REWORK_APPROVAL grant on the technician from a previous run ---" -ForegroundColor Cyan
try {
    Invoke-Api POST "/permissions/revoke" $adminToken @{ userId = $TechnicianId; permissionType = "REWORK_APPROVAL" } | Out-Null
    Write-Host "Revoked a leftover grant from a previous run (not counted - housekeeping only)." -ForegroundColor Yellow
} catch {
    Write-Host "Nothing to clean up - technician holds no active REWORK_APPROVAL grant, as expected on a fresh run." -ForegroundColor Yellow
}

$granted = Step "Grant REWORK_APPROVAL to the technician (POST /permissions/grant)" {
    Invoke-Api POST "/permissions/grant" $adminToken @{ userId = $TechnicianId; permissionType = "REWORK_APPROVAL"; notes = "Phase 7 verify" }
}
Write-Host "permissionType=$($granted.permissionType) revokedAt=$($granted.revokedAt) (expect REWORK_APPROVAL / null)"

Expect-StatusCode "Granting the SAME permission to the SAME user again is rejected (expect 409)" 409 {
    Invoke-Api POST "/permissions/grant" $adminToken @{ userId = $TechnicianId; permissionType = "REWORK_APPROVAL" }
}

$byType = Step "List everyone holding REWORK_APPROVAL (GET /permissions?type=REWORK_APPROVAL)" { Invoke-Api GET "/permissions?type=REWORK_APPROVAL" $adminToken $null }
$holdsIt = $byType | Where-Object { $_.userId -eq $TechnicianId }
Write-Host "Found $($byType.Count) active REWORK_APPROVAL holder(s); technician included: $([bool]$holdsIt) (expect true)"

$history = Step "Full grant history for the technician (GET /permissions/users/:userId)" { Invoke-Api GET "/permissions/users/$TechnicianId" $adminToken $null }
Write-Host "Got $($history.Count) grant record(s) in the technician's history (active + revoked, most recent first)"

$revoked = Step "Revoke REWORK_APPROVAL from the technician (POST /permissions/revoke)" {
    Invoke-Api POST "/permissions/revoke" $adminToken @{ userId = $TechnicianId; permissionType = "REWORK_APPROVAL"; notes = "Phase 7 verify - done testing" }
}
Write-Host "revokedAt=$($revoked.revokedAt) (expect a timestamp, not null)"

Expect-StatusCode "Revoking again with no active grant left is rejected (expect 404)" 404 {
    Invoke-Api POST "/permissions/revoke" $adminToken @{ userId = $TechnicianId; permissionType = "REWORK_APPROVAL" }
}

Expect-StatusCode "A non-admin role (technician) cannot call the admin-only grant endpoint (expect 403)" 403 {
    Invoke-Api POST "/permissions/grant" $techToken @{ userId = $TechnicianId; permissionType = "QC_APPROVAL" }
}

Write-Host "`n=================================================="
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================="
