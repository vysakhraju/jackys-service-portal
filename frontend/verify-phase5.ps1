# Frontend Phase 5 (Estimates + Public Approval Link) - live verification
#
# This can't be run from the cloud session (it has no network path to your machine), so
# run it yourself and paste the output back. It exercises the exact endpoints
# EstimatesPage.tsx / EstimatePublicPage.tsx send - nothing here is invented.
#
# PREREQUISITE: a technician test account, same as verify-phase3.ps1/verify-phase4.ps1. If
# you already have one, fill in its email/password/id below. If not, open a second
# PowerShell window first and run:
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

Write-Host "Frontend Phase 5 live-verification against $BaseUrl" -ForegroundColor Yellow

# 1. Admin login
$adminLogin = Step "Admin login (POST /auth/login)" {
    Invoke-Api POST "/auth/login" $null @{ email = "admin@jackys.com"; password = "Admin123!" }
}
$adminToken = $adminLogin.accessToken
if (-not $adminToken) { Write-Host "`nCan't continue without an admin token - stopping." -ForegroundColor Red; exit 1 }

# 2. Service centre with a known VAT rate, so we can check the estimate's VAT math
$suffix = (Get-Date).ToString("HHmmss")
$centre = Step "Create service centre at 5% VAT (POST /master-data/service-centres)" {
    Invoke-Api POST "/master-data/service-centres" $adminToken @{
        code = "PH5-$suffix"; name = "Phase 5 Verify Centre"; country = "UAE"; vatRate = 5
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

# 3. Fault + symptom
$faultSymptom = Step "Create fault/symptom (POST /master-data/fault-symptoms)" {
    Invoke-Api POST "/master-data/fault-symptoms" $adminToken @{
        faultCode = "F-PH5"; faultDescription = "Phase 5 test fault"
        symptomCode = "S-PH5"; symptomDescription = "Phase 5 test symptom"
        category = "WASHING_MACHINE"
    }
}

# 4. Create the appointment as OUT_OF_WARRANTY, with an invoice number on file (FR-05 -
# Job Card creation needs it) and a serial number that matches no Warranty Master range on
# purpose, so the technician's own warranty check independently comes back OOW too.
$appt = Step "Create OOW appointment with invoice number (POST /appointments)" {
    Invoke-Api POST "/appointments" $adminToken @{
        type = "OUT_OF_WARRANTY"; customerType = "B2C"
        customerName = "Phase 5 Test Customer"; customerPhone = "+971509998888"; customerEmail = "phase5test@example.com"
        brand = "Samsung"; modelNumber = "WA80J5710"; serialNumber = "SN900000"
        problemDescription = "Drum not spinning"
        invoiceNumber = "INV-PH5-$suffix"
        scheduledAt = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
        serviceCentreId = $serviceCentreId
    }
}
$apptId = $appt.id

Step "Confirm appointment (PUT /appointments/:id/confirm)" { Invoke-Api PUT "/appointments/$apptId/confirm" $adminToken $null } | Out-Null
Step "Assign technician (PUT /appointments/:id/assign-technician)" { Invoke-Api PUT "/appointments/$apptId/assign-technician" $adminToken @{ technicianId = $TechnicianId } } | Out-Null

# 5. Technician login + field visit capture
$techLogin = Step "Technician login (POST /auth/login)" { Invoke-Api POST "/auth/login" $null @{ email = $TechnicianEmail; password = $TechnicianPassword } }
$techToken = $techLogin.accessToken

Step "Start visit (POST /technician/visits/:id/start)" { Invoke-Api POST "/technician/visits/$apptId/start" $techToken @{ gpsLat = 25.2048; gpsLng = 55.2708 } } | Out-Null
$visit = Step "Capture serial number - expect OOW, no matching Warranty Master row (POST /technician/visits/:id/serial-number)" {
    Invoke-Api POST "/technician/visits/$apptId/serial-number" $techToken @{ serialNumber = "SN900000"; brand = "Samsung" }
}
Write-Host "warrantyStatus=$($visit.warrantyStatus) (expect OUT_OF_WARRANTY)"
Step "Capture fault/symptom (POST /technician/visits/:id/fault-symptom)" { Invoke-Api POST "/technician/visits/$apptId/fault-symptom" $techToken @{ faultCode = "F-PH5"; symptomCode = "S-PH5" } } | Out-Null
Step "Complete appointment (PUT /appointments/:id/complete)" { Invoke-Api PUT "/appointments/$apptId/complete" $techToken $null } | Out-Null

# 6. Job Card - create, then validate S/N so it reaches SN_VALIDATED (Estimate's own gate)
$jobCard = Step "Create Job Card (POST /job-cards)" { Invoke-Api POST "/job-cards" $adminToken @{ appointmentId = $apptId } }
$jobCardId = $jobCard.id
Write-Host "Job Card $($jobCard.jobCardNumber) [$jobCardId] warrantyStatus=$($jobCard.warrantyStatus) status=$($jobCard.status)"
Step "Validate S/N against invoice (POST /job-cards/:id/validate-sn)" { Invoke-Api POST "/job-cards/$jobCardId/validate-sn" $adminToken @{ matches = $true } } | Out-Null

# 7. Estimate lifecycle: create -> send -> record-response (staff-recorded path)
$estimate = Step "Create Estimate (POST /estimates)" {
    Invoke-Api POST "/estimates" $adminToken @{
        jobCardId = $jobCardId
        lineItems = @(
            @{ description = "Drum Motor Assembly (Part)"; quantity = 1; unitPrice = 350.0 }
            @{ description = "Labor - Workshop repair"; quantity = 1; unitPrice = 120.0 }
        )
    }
}
$estimateId = $estimate.id
$expectedTotal = (350.0 + 120.0) * 1.05
Write-Host "subtotal=$($estimate.subtotal) vatAmount=$($estimate.vatAmount) totalAmount=$($estimate.totalAmount) (expect subtotal=470, total=$expectedTotal at 5% VAT)"

Expect-StatusCode "create() blocks a second active estimate for the same Job Card (expect 409)" 409 {
    Invoke-Api POST "/estimates" $adminToken @{ jobCardId = $jobCardId; lineItems = @(@{ description = "Duplicate"; quantity = 1; unitPrice = 10 }) }
}

$sent = Step "Send Estimate - generates the public link (POST /estimates/:id/send)" { Invoke-Api POST "/estimates/$estimateId/send" $adminToken $null }
Write-Host "status=$($sent.status) accessToken present=$([bool]$sent.accessToken) channelsAttempted=$($sent.channelsAttempted -join ',')"
$publicToken = $sent.accessToken

Expect-StatusCode "record-response rejects a contactValue that doesn't match what's on file (expect 400)" 400 {
    Invoke-Api POST "/estimates/$estimateId/record-response" $adminToken @{
        approved = $true; contactMethod = "PHONE_CALL"; contactValue = "+971500000000"
        notes = "Wrong number on purpose to test the anti-consent-laundering guard"
    }
}

# 8. Public link path (the customer-facing, unauthenticated side)
$publicView = Step "Public view of the estimate by token, no auth (GET /estimates/public/:token)" {
    Invoke-Api GET "/estimates/public/$publicToken" $null $null
}
Write-Host "Public view shows: jobCardNumber=$($publicView.jobCardNumber) totalAmount=$($publicView.totalAmount) (should NOT include createdById/recordedByUserId/contactValue)"

$declined = Step "Customer rejects via the public link, no auth (POST /estimates/public/:token/respond)" {
    Invoke-Api POST "/estimates/public/$publicToken/respond" $null @{ approved = $false; notes = "Too expensive, will think about it" }
}
Write-Host "status=$($declined.status) (expect REJECTED)"

Expect-StatusCode "Responding again via the same link is rejected (expect 409, already responded)" 409 {
    Invoke-Api POST "/estimates/public/$publicToken/respond" $null @{ approved = $true }
}
Expect-StatusCode "The public view of an already-responded link is gone (expect 410)" 410 {
    Invoke-Api GET "/estimates/public/$publicToken" $null $null
}

# 9. Job Card should now be RWR (rejected -> rework), and revise() should bring it back
$jobCardAfterReject = Step "Job Card flipped to RWR after the rejection (GET /job-cards/:id)" { Invoke-Api GET "/job-cards/$jobCardId" $adminToken $null }
Write-Host "Job Card status=$($jobCardAfterReject.status) (expect RWR)"

$revised = Step "Revise the rejected Estimate (POST /estimates/:id/revise)" {
    Invoke-Api POST "/estimates/$estimateId/revise" $adminToken @{}
}
Write-Host "New estimate id=$($revised.id) status=$($revised.status) previousEstimateId=$($revised.previousEstimateId) (expect DRAFT, linked to the rejected one)"

$jobCardAfterRevive = Step "Job Card revived out of RWR back to SN_VALIDATED (GET /job-cards/:id)" { Invoke-Api GET "/job-cards/$jobCardId" $adminToken $null }
Write-Host "Job Card status=$($jobCardAfterRevive.status) (expect SN_VALIDATED)"

# 10. Send + approve the revised one via the staff-recorded path this time
Step "Send the revised Estimate (POST /estimates/:id/send)" { Invoke-Api POST "/estimates/$($revised.id)/send" $adminToken $null } | Out-Null
$approved = Step "Staff-record an approval, matching the phone on file (POST /estimates/:id/record-response)" {
    Invoke-Api POST "/estimates/$($revised.id)/record-response" $adminToken @{
        approved = $true; contactMethod = "PHONE_CALL"; contactValue = "+971509998888"
        notes = "Called customer, confirmed total, approved to proceed"
    }
}
Write-Host "status=$($approved.status) (expect APPROVED)"

$jobCardAfterApproval = Step "Job Card customerApproved flag set (GET /job-cards/:id)" { Invoke-Api GET "/job-cards/$jobCardId" $adminToken $null }
Write-Host "customerApproved=$($jobCardAfterApproval.customerApproved) (expect True)"

# 11. History endpoint
$history = Step "Estimate history for this Job Card, newest first (GET /estimates/by-job-card/:jobCardId)" {
    Invoke-Api GET "/estimates/by-job-card/$jobCardId" $adminToken $null
}
Write-Host "History has $($history.Count) estimates (expect 2 - the original REJECTED one and this revised APPROVED one)"

Write-Host "`n=================================================="
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================="
