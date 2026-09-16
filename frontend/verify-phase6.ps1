# Frontend Phase 6 (Workshop + Inventory) - live verification
#
# This can't be run from the cloud session (it has no network path to your machine), so
# run it yourself and paste the output back. It exercises the exact endpoints
# WorkshopPage.tsx / InventoryPage.tsx send, plus the QC reject -> rework-gate path those
# screens surface fields for (QC approve/reject themselves are Frontend Phase 7 screens,
# but the backend endpoints already exist and this is the only way to make
# qcRejectionCount > 0 so the rework gate is worth anything) - nothing here is invented.
#
# FIXED (after a rerun 409'd): the fault/symptom codes below were hardcoded ("F-PH6"/
# "S-PH6") instead of suffixed like every other test-data field in this script, so a
# second run hit a real 409 (fault/symptom codes are unique) - now suffixed with $suffix
# like everything else, so reruns are idempotent again.
#
# PREREQUISITE: a technician test account, same as verify-phase3/4/5.ps1. If you already
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

Write-Host "Frontend Phase 6 live-verification against $BaseUrl" -ForegroundColor Yellow
$suffix = (Get-Date).ToString("HHmmss")

# 1. Admin login + self-grant QC_APPROVAL (admin-assignable, not role-based - Phase 6's
# whole point - so even SUPER_ADMIN needs an explicit grant to use qc/reject below).
$adminLogin = Step "Admin login (POST /auth/login)" { Invoke-Api POST "/auth/login" $null @{ email = "admin@jackys.com"; password = "Admin123!" } }
$adminToken = $adminLogin.accessToken
if (-not $adminToken) { Write-Host "`nCan't continue without an admin token - stopping." -ForegroundColor Red; exit 1 }
$adminProfile = Step "Admin profile (GET /auth/profile)" { Invoke-Api GET "/auth/profile" $adminToken $null }
$adminUserId = $adminProfile.id

# Idempotent across reruns on purpose: the grant is tied to the admin user, not a
# per-run $suffix like everything else below, so a second run of this script hitting a
# 409 "already holds this grant" here is expected, not a real failure.
Write-Host "`n--- Grant admin the QC_APPROVAL permission (POST /permissions/grant) ---" -ForegroundColor Cyan
try {
    Invoke-Api POST "/permissions/grant" $adminToken @{ userId = $adminUserId; permissionType = "QC_APPROVAL"; notes = "Phase 6 verify script" } | Out-Null
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

# 2. Service centre, warranty master (IN_WARRANTY path - no Estimate/customer-approval
# needed to reach section assignment), fault/symptom
$centre = Step "Create service centre (POST /master-data/service-centres)" {
    Invoke-Api POST "/master-data/service-centres" $adminToken @{
        code = "PH6-$suffix"; name = "Phase 6 Verify Centre"; country = "UAE"; vatRate = 5
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

Step "Create warranty master entry so the visit returns IN_WARRANTY (POST /master-data/warranty-master)" {
    Invoke-Api POST "/master-data/warranty-master" $adminToken @{
        serialNumberRange = "SN700000-SN799999"; brand = "Samsung"; model = "WA80J5710"
        warrantyPeriodMonths = 24; supplier = "Samsung Gulf"
    }
} | Out-Null

Step "Create fault/symptom (POST /master-data/fault-symptoms)" {
    Invoke-Api POST "/master-data/fault-symptoms" $adminToken @{
        faultCode = "F-PH6-$suffix"; faultDescription = "Phase 6 test fault"
        symptomCode = "S-PH6-$suffix"; symptomDescription = "Phase 6 test symptom"
        category = "WASHING_MACHINE"
    }
} | Out-Null

# 3. Spare part model + two spare parts - one linked (GRN allowed), one not (AC-17 block)
$model = Step "Create spare part model (POST /master-data/spare-part-models)" {
    Invoke-Api POST "/master-data/spare-part-models" $adminToken @{ modelId = "PH6MODEL-$suffix"; brand = "Samsung"; modelName = "WA80J5710" }
}
$sparePartA = Step "Create spare part A (POST /master-data/spare-parts)" {
    Invoke-Api POST "/master-data/spare-parts" $adminToken @{ code = "SP-PH6A-$suffix"; name = "Drum Motor Assembly"; category = "MOTOR"; unitCost = 100 }
}
$sparePartAId = $sparePartA.id
$sparePartB = Step "Create spare part B - deliberately NOT linked to any model (POST /master-data/spare-parts)" {
    Invoke-Api POST "/master-data/spare-parts" $adminToken @{ code = "SP-PH6B-$suffix"; name = "Unlinked Part"; category = "MOTOR"; unitCost = 50 }
}
$sparePartBId = $sparePartB.id
Step "Link spare part A to the model (POST /master-data/spare-parts/:id/link-model)" {
    Invoke-Api POST "/master-data/spare-parts/$sparePartAId/link-model" $adminToken @{ modelId = $model.id }
} | Out-Null

# 4. GRN: receive stock for A, confirm B is blocked (AC-17)
$grn1 = Step "GRN: receive 5 units of spare part A (POST /inventory/grn)" {
    Invoke-Api POST "/inventory/grn" $adminToken @{ sparePartId = $sparePartAId; quantity = 5; notes = "Phase 6 verify - initial stock" }
}
Write-Host "quantityOnHand=$($grn1.quantityOnHand) (expect 5)"
Expect-StatusCode "AC-17: GRN for an unlinked spare part is blocked (expect 400)" 400 {
    Invoke-Api POST "/inventory/grn" $adminToken @{ sparePartId = $sparePartBId; quantity = 5 }
}

# 5. Appointment (IN_WARRANTY) -> confirm -> assign technician -> field visit -> Job Card
$appt = Step "Create WARRANTY-type appointment (POST /appointments)" {
    Invoke-Api POST "/appointments" $adminToken @{
        type = "WARRANTY"; customerType = "B2C"
        customerName = "Phase 6 Test Customer"; customerPhone = "+971507778888"; customerEmail = "phase6test@example.com"
        brand = "Samsung"; modelNumber = "WA80J5710"; serialNumber = "SN750000"
        problemDescription = "Drum motor noise"
        invoiceNumber = "INV-PH6-$suffix"
        scheduledAt = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
        serviceCentreId = $serviceCentreId
    }
}
$apptId = $appt.id
Step "Confirm appointment" { Invoke-Api PUT "/appointments/$apptId/confirm" $adminToken $null } | Out-Null
Step "Assign technician" { Invoke-Api PUT "/appointments/$apptId/assign-technician" $adminToken @{ technicianId = $TechnicianId } } | Out-Null

$techLogin = Step "Technician login" { Invoke-Api POST "/auth/login" $null @{ email = $TechnicianEmail; password = $TechnicianPassword } }
$techToken = $techLogin.accessToken
Step "Start visit" { Invoke-Api POST "/technician/visits/$apptId/start" $techToken @{ gpsLat = 25.2048; gpsLng = 55.2708 } } | Out-Null
$visit = Step "Capture serial number - expect a real IN_WARRANTY badge" { Invoke-Api POST "/technician/visits/$apptId/serial-number" $techToken @{ serialNumber = "SN750000"; brand = "Samsung" } }
Write-Host "warrantyStatus=$($visit.warrantyStatus) (expect IN_WARRANTY)"
Step "Capture fault/symptom" { Invoke-Api POST "/technician/visits/$apptId/fault-symptom" $techToken @{ faultCode = "F-PH6-$suffix"; symptomCode = "S-PH6-$suffix" } } | Out-Null
Step "Complete appointment" { Invoke-Api PUT "/appointments/$apptId/complete" $techToken $null } | Out-Null

$jobCard = Step "Create Job Card (POST /job-cards)" { Invoke-Api POST "/job-cards" $adminToken @{ appointmentId = $apptId } }
$jobCardId = $jobCard.id
Step "Validate S/N (POST /job-cards/:id/validate-sn)" { Invoke-Api POST "/job-cards/$jobCardId/validate-sn" $adminToken @{ matches = $true } } | Out-Null
$sectioned = Step "Assign section = WORKSHOP (POST /job-cards/:id/assign-section)" { Invoke-Api POST "/job-cards/$jobCardId/assign-section" $adminToken @{ section = "WORKSHOP" } }
Write-Host "status=$($sectioned.status) section=$($sectioned.section) (expect SECTION_ASSIGNED / WORKSHOP)"

# 6. Workshop lifecycle
Expect-StatusCode "requestSpare before a technician is assigned is rejected (expect 400)" 400 {
    Invoke-Api POST "/workshop/$jobCardId/request-spare" $adminToken @{ sparePartId = $sparePartAId; quantity = 1 }
}
$assigned = Step "Assign workshop technician (POST /workshop/:jobCardId/assign)" { Invoke-Api POST "/workshop/$jobCardId/assign" $adminToken @{ technicianId = $TechnicianId } }
Write-Host "status=$($assigned.status) (expect WORKSHOP_ASSIGNED)"

Expect-StatusCode "requestSpare before startWip is rejected (expect 400)" 400 {
    Invoke-Api POST "/workshop/$jobCardId/request-spare" $adminToken @{ sparePartId = $sparePartAId; quantity = 1 }
}
$wip = Step "Start WIP (POST /workshop/:jobCardId/start-wip)" { Invoke-Api POST "/workshop/$jobCardId/start-wip" $adminToken $null }
Write-Host "status=$($wip.status) (expect IN_PROGRESS)"

$res1 = Step "Request spare: 2 of 5 available - expect HELD (POST /workshop/:jobCardId/request-spare)" {
    Invoke-Api POST "/workshop/$jobCardId/request-spare" $adminToken @{ sparePartId = $sparePartAId; quantity = 2 }
}
Write-Host "status=$($res1.status) quantityReserved=$($res1.quantityReserved)/$($res1.quantityRequested) (expect HELD 2/2)"

$res2 = Step "Request spare: 10 of remaining 3 available - expect PARTIALLY_RESERVED" {
    Invoke-Api POST "/workshop/$jobCardId/request-spare" $adminToken @{ sparePartId = $sparePartAId; quantity = 10 }
}
Write-Host "status=$($res2.status) quantityReserved=$($res2.quantityReserved)/$($res2.quantityRequested) (expect PARTIALLY_RESERVED 3/10)"

$stateAfterShortfall = Step "Job Card flips to SPARE_PENDING on the shortfall (GET /workshop/:jobCardId)" { Invoke-Api GET "/workshop/$jobCardId" $adminToken $null }
Write-Host "jobCard.status=$($stateAfterShortfall.jobCard.status) (expect SPARE_PENDING)"

Expect-StatusCode "complete() is blocked while SPARE_PENDING (expect 400)" 400 {
    Invoke-Api POST "/workshop/$jobCardId/complete" $adminToken $null
}

Step "GRN top-up: receive 10 more units of spare part A" { Invoke-Api POST "/inventory/grn" $adminToken @{ sparePartId = $sparePartAId; quantity = 10 } } | Out-Null
$res3 = Step "Top-up request: 2 units, now fully available - expect HELD" {
    Invoke-Api POST "/workshop/$jobCardId/request-spare" $adminToken @{ sparePartId = $sparePartAId; quantity = 2 }
}
Write-Host "status=$($res3.status) (expect HELD)"
$stateAfterTopUp = Step "Job Card resumes to IN_PROGRESS after the fully-filled top-up (GET /workshop/:jobCardId)" { Invoke-Api GET "/workshop/$jobCardId" $adminToken $null }
Write-Host "jobCard.status=$($stateAfterTopUp.jobCard.status) (expect IN_PROGRESS)"

$completed = Step "Complete workshop work (POST /workshop/:jobCardId/complete)" { Invoke-Api POST "/workshop/$jobCardId/complete" $adminToken $null }
Write-Host "status=$($completed.status) (expect READY_FOR_QC)"

$res4 = Step "Top-up request still works on a READY_FOR_QC job (workshop.service.ts's own documented exception)" {
    Invoke-Api POST "/workshop/$jobCardId/request-spare" $adminToken @{ sparePartId = $sparePartAId; quantity = 1 }
}
$stateStillReadyForQc = Step "Job Card status is untouched by that top-up (GET /workshop/:jobCardId)" { Invoke-Api GET "/workshop/$jobCardId" $adminToken $null }
Write-Host "jobCard.status=$($stateStillReadyForQc.jobCard.status) (expect still READY_FOR_QC, not reverted to IN_PROGRESS)"

# 7. Stock numbers sanity check
$stockA = Step "Stock lookup for spare part A, Main Store (GET /inventory/stock/:sparePartId)" { Invoke-Api GET "/inventory/stock/$sparePartAId" $adminToken $null }
Write-Host "quantityOnHand=$($stockA.quantityOnHand) quantityReserved=$($stockA.quantityReserved) (expect 15 on hand, 8 reserved: 2+3+2+1)"

# 8. Reservation review -> RETURN_PENDING -> confirmReturn (the only path that increments
# stock back), plus the negative cases around it
$reviewed = Step "Review reservation 1: approve reallocation (POST /inventory/reservations/:id/review)" {
    Invoke-Api POST "/inventory/reservations/$($res1.id)/review" $adminToken @{ decision = "APPROVE_REALLOCATION"; notes = "Phase 6 verify - reallocating" }
}
Write-Host "status=$($reviewed.status) (expect RETURN_PENDING)"
$returned = Step "Confirm the physical return of reservation 1 (POST /inventory/reservations/:id/confirm-return)" {
    Invoke-Api POST "/inventory/reservations/$($res1.id)/confirm-return" $adminToken @{ quantityReturned = 2 }
}
Write-Host "status=$($returned.status) quantityReturned=$($returned.quantityReturned) (expect RETURNED / 2)"

Expect-StatusCode "requestReturn on an already-RETURNED reservation is rejected (expect 400)" 400 {
    Invoke-Api POST "/inventory/reservations/$($res1.id)/request-return" $adminToken $null
}

$returnPending2 = Step "Request return on reservation 2 (still PARTIALLY_RESERVED) on the technician's behalf" {
    Invoke-Api POST "/inventory/reservations/$($res2.id)/request-return" $adminToken $null
}
Write-Host "status=$($returnPending2.status) (expect RETURN_PENDING)"
Expect-StatusCode "confirmReturn rejects returning more than was ever reserved (expect 400)" 400 {
    Invoke-Api POST "/inventory/reservations/$($res2.id)/confirm-return" $adminToken @{ quantityReturned = 999 }
}
Step "Confirm the correct quantity for reservation 2" { Invoke-Api POST "/inventory/reservations/$($res2.id)/confirm-return" $adminToken @{ quantityReturned = 3 } } | Out-Null

$staleList = Step "Stale reservations list, the one real list endpoint in this module (GET /inventory/reservations/stale)" { Invoke-Api GET "/inventory/reservations/stale" $adminToken $null }
Write-Host "Got $($staleList.Count) stale reservation(s) right now (fresh reservations from this run won't be in it yet - by design, see Frontend Phase 6's known gap)"

# 9. QC reject -> rework gate (the-fool pre-mortem's hardest edge case: a same-part
# re-request after a QC rejection needs sign-off or a verbal override)
$stateBeforeReject = Step "Confirm still READY_FOR_QC before rejecting (GET /workshop/:jobCardId)" { Invoke-Api GET "/workshop/$jobCardId" $adminToken $null }
Write-Host "jobCard.status=$($stateBeforeReject.jobCard.status) (expect READY_FOR_QC)"
$rejected = Step "QC reject (POST /job-cards/:id/qc/reject) - requires the QC_APPROVAL grant we self-granted in step 1" {
    Invoke-Api POST "/job-cards/$jobCardId/qc/reject" $adminToken @{ reason = "Phase 6 verify - forcing a rework re-request to test the gate" }
}
Write-Host "status=$($rejected.status) qcRejectionCount=$($rejected.qcRejectionCount) (expect IN_PROGRESS / 1)"

Expect-StatusCode "Rework re-request of the SAME part with no approver/verbal override is rejected (expect 400)" 400 {
    Invoke-Api POST "/workshop/$jobCardId/request-spare" $adminToken @{ sparePartId = $sparePartAId; quantity = 1 }
}
Expect-StatusCode "Rework re-request naming the requester themselves as approver is rejected (expect 400)" 400 {
    Invoke-Api POST "/workshop/$jobCardId/request-spare" $adminToken @{ sparePartId = $sparePartAId; quantity = 1; approverId = $adminUserId }
}
$reworkRes = Step "Rework re-request via verbal override succeeds (POST /workshop/:jobCardId/request-spare)" {
    Invoke-Api POST "/workshop/$jobCardId/request-spare" $adminToken @{
        sparePartId = $sparePartAId; quantity = 1
        verbalOverrideBy = "Team Leader on shift (Phase 6 verify)"
        verbalOverrideNotes = "No REWORK_APPROVAL holder reachable right now - verified in person before re-requesting the same part."
    }
}
Write-Host "status=$($reworkRes.status) reworkVerbalOverrideBy=$($reworkRes.reworkVerbalOverrideBy) (expect a reservation with that field set)"

Write-Host "`n=================================================="
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================="
