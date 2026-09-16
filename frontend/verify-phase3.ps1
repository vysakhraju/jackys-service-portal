# Frontend Phase 3 (Appointment Scheduling + Technician Field View) - live verification
#
# This can't be run from the cloud session (it has no network path to your machine),
# so run it yourself and paste the output back. It exercises the exact endpoints and
# payload shapes SchedulePage.tsx / FieldVisitsPage.tsx send - nothing here is invented.
#
# PREREQUISITE: a technician test account. If you already have one from an earlier
# session (Section 4 of TESTING_GUIDE.md), fill in its email/password/id below. If not,
# open a second PowerShell window first and run:
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
 
Write-Host "Frontend Phase 3 live-verification against $BaseUrl" -ForegroundColor Yellow
 
# 1. Admin login
$adminLogin = Step "Admin login (POST /auth/login)" {
    Invoke-Api POST "/auth/login" $null @{ email = "admin@jackys.com"; password = "Admin123!" }
}
$adminToken = $adminLogin.accessToken
if (-not $adminToken) { Write-Host "`nCan't continue without an admin token - stopping." -ForegroundColor Red; exit 1 }
 
# 2. Service centre (fresh one each run, code suffixed with the current time)
$suffix = (Get-Date).ToString("HHmmss")
$centre = Step "Create service centre (POST /master-data/service-centres)" {
    Invoke-Api POST "/master-data/service-centres" $adminToken @{
        code = "PH3-$suffix"; name = "Phase 3 Verify Centre"; country = "UAE"; vatRate = 5
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
 
# 3. Fault + symptom (technician capture needs real codes)
$faultSymptom = Step "Create fault/symptom (POST /master-data/fault-symptoms)" {
    Invoke-Api POST "/master-data/fault-symptoms" $adminToken @{
        faultCode = "F-PH3"; faultDescription = "Phase 3 test fault"
        symptomCode = "S-PH3"; symptomDescription = "Phase 3 test symptom"
        category = "WASHING_MACHINE"
    }
}
 
# 4. Warranty master (so the S/N capture step returns a real IN_WARRANTY badge)
$warranty = Step "Create warranty master entry (POST /master-data/warranty-master)" {
    Invoke-Api POST "/master-data/warranty-master" $adminToken @{
        serialNumberRange = "SN100000-SN199999"; brand = "Samsung"; model = "WA80J5710"
        warrantyPeriodMonths = 24; supplier = "Samsung Gulf"
    }
}
 
# 5. Create the appointment
$appt = Step "Create appointment (POST /appointments)" {
    Invoke-Api POST "/appointments" $adminToken @{
        type = "OUT_OF_WARRANTY"; customerType = "B2C"
        customerName = "Phase 3 Test Customer"; customerPhone = "+971501234567"
        brand = "Samsung"; modelNumber = "WA80J5710"; serialNumber = "SN150000"
        problemDescription = "Washing machine not draining"
        scheduledAt = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
        serviceCentreId = $serviceCentreId
    }
}
$apptId = $appt.id
Write-Host "Created appointment $($appt.appointmentNumber) [$apptId] status=$($appt.status)"
 
# 6. Confirm it
$confirmed = Step "Confirm appointment (PUT /appointments/:id/confirm)" {
    Invoke-Api PUT "/appointments/$apptId/confirm" $adminToken $null
}
Write-Host "Status now: $($confirmed.status) (expect CONFIRMED)"
 
# 7. Assign the technician
$assigned = Step "Assign technician (PUT /appointments/:id/assign-technician)" {
    Invoke-Api PUT "/appointments/$apptId/assign-technician" $adminToken @{ technicianId = $TechnicianId }
}
Write-Host "Status now: $($assigned.status) (expect TECHNICIAN_ASSIGNED)"
 
# 8. List appointments with filters + pagination (what SchedulePage's table calls)
$list = Step "List appointments with filters (GET /appointments)" {
    Invoke-Api GET "/appointments?serviceCentreId=$serviceCentreId&page=1&limit=5" $adminToken $null
}
Write-Host "Got $($list.total) total, $($list.data.Count) on this page (expect data/total/page/limit shape)"
 
# 9. Technician login
$techLogin = Step "Technician login (POST /auth/login)" {
    Invoke-Api POST "/auth/login" $null @{ email = $TechnicianEmail; password = $TechnicianPassword }
}
$techToken = $techLogin.accessToken
 
# 10. Technician's own schedule
Step "Technician schedule (GET /technician/schedule)" {
    Invoke-Api GET "/technician/schedule" $techToken $null
} | Out-Null
 
# 11. Start visit (GPS capture) - should also flip the appointment to ON_SITE
$visit = Step "Start visit (POST /technician/visits/:id/start)" {
    Invoke-Api POST "/technician/visits/$apptId/start" $techToken @{ gpsLat = 25.2048; gpsLng = 55.2708 }
}
 
# 12. Capture serial number - expect a real IN_WARRANTY badge back
$visit = Step "Capture serial number (POST /technician/visits/:id/serial-number)" {
    Invoke-Api POST "/technician/visits/$apptId/serial-number" $techToken @{ serialNumber = "SN150000"; brand = "Samsung" }
}
Write-Host "warrantyStatus=$($visit.warrantyStatus) supplier=$($visit.warrantySupplier) (expect IN_WARRANTY / Samsung Gulf)"
 
# 13. Capture fault/symptom
Step "Capture fault/symptom (POST /technician/visits/:id/fault-symptom)" {
    Invoke-Api POST "/technician/visits/$apptId/fault-symptom" $techToken @{ faultCode = "F-PH3"; symptomCode = "S-PH3" }
} | Out-Null
 
# 14. Complete the appointment (technician is allowed to do this directly)
$completed = Step "Complete appointment (PUT /appointments/:id/complete)" {
    Invoke-Api PUT "/appointments/$apptId/complete" $techToken $null
}
Write-Host "Status now: $($completed.status) (expect COMPLETED)"
 
# 15. Cancel guardrail: a second appointment, cancel reason too short should 400
$appt2 = Step "Create second appointment (for the cancel test)" {
    Invoke-Api POST "/appointments" $adminToken @{
        type = "OUT_OF_WARRANTY"; customerType = "B2C"
        customerName = "Phase 3 Cancel Test"; customerPhone = "+971501234568"
        scheduledAt = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
        serviceCentreId = $serviceCentreId
    }
}
$appt2Id = $appt2.id
 
$shortReasonBlocked = $false
try {
    Invoke-Api PUT "/appointments/$appt2Id/cancel" $adminToken @{ reason = "no" }
    Write-Host "FAIL: cancel with a 2-char reason should have been rejected (400) but succeeded" -ForegroundColor Red
    $fail++
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 400) {
        Write-Host "PASS: cancel with a too-short reason correctly returned 400" -ForegroundColor Green
        $pass++
        $shortReasonBlocked = $true
    } else {
        Write-Host "FAIL: expected 400 for a too-short cancel reason, got $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
        $fail++
    }
}
 
$cancelled = Step "Cancel with a valid reason (PUT /appointments/:id/cancel)" {
    Invoke-Api PUT "/appointments/$appt2Id/cancel" $adminToken @{ reason = "Phase 3 verification - cleaning up test data" }
}
Write-Host "Status now: $($cancelled.status) (expect CANCELLED)"
 
Write-Host "`n=================================================="
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================="