# Frontend Phase 4 (Job Cards + Warranty Override) - live verification
#
# Same reasoning as verify-phase3.ps1: the cloud build session has no network path to
# this machine, so this runs here and you paste the output back.
#
# Technician credentials default to the ones from the Phase 3 run - change them if you
# used different ones, or re-run `npm run seed:technician` for a fresh account.

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

# For guardrail checks where a NON-2xx response is the expected, correct behavior.
function Expect-StatusCode($name, [int]$expected, $block) {
    Write-Host "`n--- $name (expect HTTP $expected) ---" -ForegroundColor Cyan
    try {
        & $block
        Write-Host "FAIL: $name - call succeeded but should have been rejected" -ForegroundColor Red
        $script:fail++
    } catch {
        $actual = $_.Exception.Response.StatusCode.value__
        if ($actual -eq $expected) {
            Write-Host "PASS: $name (got $actual)" -ForegroundColor Green
            $script:pass++
        } else {
            Write-Host "FAIL: $name - expected $expected, got $actual" -ForegroundColor Red
            if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
            $script:fail++
        }
    }
}

function Invoke-Api($Method, $Path, $Token, $Body) {
    $headers = @{}
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    $params = @{ Method = $Method; Uri = "$BaseUrl$Path"; Headers = $headers; ContentType = "application/json" }
    if ($Body) { $params["Body"] = ($Body | ConvertTo-Json -Depth 10) }
    return Invoke-RestMethod @params
}

Write-Host "Frontend Phase 4 live-verification against $BaseUrl" -ForegroundColor Yellow

# --- Setup shared by both flows ---
$adminLogin = Step "Admin login" { Invoke-Api POST "/auth/login" $null @{ email = "admin@jackys.com"; password = "Admin123!" } }
$adminToken = $adminLogin.accessToken
if (-not $adminToken) { Write-Host "`nCan't continue without an admin token - stopping." -ForegroundColor Red; exit 1 }

$techLogin = Step "Technician login" { Invoke-Api POST "/auth/login" $null @{ email = $TechnicianEmail; password = $TechnicianPassword } }
$techToken = $techLogin.accessToken
if (-not $techToken) { Write-Host "`nCan't continue without a technician token - stopping." -ForegroundColor Red; exit 1 }

$suffix = (Get-Date).ToString("HHmmss")
$centre = Step "Create service centre" {
    Invoke-Api POST "/master-data/service-centres" $adminToken @{
        code = "PH4-$suffix"; name = "Phase 4 Verify Centre"; country = "UAE"; vatRate = 5
        schedule = @{
            monday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            tuesday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            wednesday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            thursday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            friday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            saturday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 }
            sunday = @{ isOpen = $false; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 0 }
        }
    }
}
$serviceCentreId = $centre.id

Step "Create fault/symptom (F-PH4/S-PH4)" {
    Invoke-Api POST "/master-data/fault-symptoms" $adminToken @{
        faultCode = "F-PH4-$suffix"; faultDescription = "Phase 4 test fault"
        symptomCode = "S-PH4-$suffix"; symptomDescription = "Phase 4 test symptom"
        category = "WASHING_MACHINE"
    }
} | Out-Null
$faultCode = "F-PH4-$suffix"
$symptomCode = "S-PH4-$suffix"

Step "Create warranty master entry (fresh range for this run)" {
    Invoke-Api POST "/master-data/warranty-master" $adminToken @{
        serialNumberRange = "SN400000-SN499999"; brand = "Samsung"; model = "WA80J5710"
        warrantyPeriodMonths = 24; supplier = "Samsung Gulf"
    }
} | Out-Null

function New-CompletedAppointment($type, $serialNumber, $label) {
    $appt = Invoke-Api POST "/appointments" $adminToken @{
        type = $type; customerType = "B2C"
        customerName = "Phase 4 $label"; customerPhone = "+971501234599"
        brand = "Samsung"; modelNumber = "WA80J5710"; serialNumber = $serialNumber
        invoiceNumber = "INV-PH4-$suffix-$label"
        problemDescription = "Phase 4 verification run"
        scheduledAt = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
        serviceCentreId = $serviceCentreId
    }
    Invoke-Api PUT "/appointments/$($appt.id)/confirm" $adminToken $null | Out-Null
    Invoke-Api PUT "/appointments/$($appt.id)/assign-technician" $adminToken @{ technicianId = $TechnicianId } | Out-Null
    Invoke-Api POST "/technician/visits/$($appt.id)/start" $techToken @{ gpsLat = 25.2048; gpsLng = 55.2708 } | Out-Null
    Invoke-Api POST "/technician/visits/$($appt.id)/serial-number" $techToken @{ serialNumber = $serialNumber; brand = "Samsung" } | Out-Null
    Invoke-Api POST "/technician/visits/$($appt.id)/fault-symptom" $techToken @{ faultCode = $faultCode; symptomCode = $symptomCode } | Out-Null
    Invoke-Api PUT "/appointments/$($appt.id)/complete" $techToken $null | Out-Null
    return $appt
}

# =================== Flow A: in-warranty job, straight through, then override + cancel ===================
Write-Host "`n============ FLOW A: in-warranty job card ============" -ForegroundColor Yellow
$apptA = Step "Create + complete appointment A (WARRANTY, S/N in-range)" {
    New-CompletedAppointment "WARRANTY" "SN450000" "A"
}

$jcA = Step "Create Job Card A (POST /job-cards)" {
    Invoke-Api POST "/job-cards" $adminToken @{ appointmentId = $apptA.id }
}
Write-Host "Job Card $($jcA.jobCardNumber) status=$($jcA.status) warrantyStatus=$($jcA.warrantyStatus) (expect OPEN / IW)"

$jcA = Step "Validate S/N - matches (POST /job-cards/:id/validate-sn)" {
    Invoke-Api POST "/job-cards/$($jcA.id)/validate-sn" $adminToken @{ matches = $true }
}
Write-Host "Status now: $($jcA.status) (expect SN_VALIDATED)"

$jcA = Step "Assign section - no approval needed, in-warranty (POST /job-cards/:id/assign-section)" {
    Invoke-Api POST "/job-cards/$($jcA.id)/assign-section" $adminToken @{ section = "ON_SITE_REPAIR" }
}
Write-Host "Status now: $($jcA.status) (expect SECTION_ASSIGNED)"

$jcA = Step "Warranty override to OOW (POST /job-cards/:id/warranty-override)" {
    Invoke-Api POST "/job-cards/$($jcA.id)/warranty-override" $adminToken @{ newStatus = "OOW"; reason = "Phase 4 verification - flipping to OOW to test the override guardrail" }
}
Write-Host "warrantyStatus=$($jcA.warrantyStatus) overrideCount=$($jcA.overrideCount) customerApproved=$($jcA.customerApproved) (expect OOW / 1 / False)"

Expect-StatusCode "Override to the same status again should 400" 400 {
    Invoke-Api POST "/job-cards/$($jcA.id)/warranty-override" $adminToken @{ newStatus = "OOW"; reason = "Should be rejected - already OOW" }
}

$jcA = Step "Cancel Job Card A (POST /job-cards/:id/cancel)" {
    Invoke-Api POST "/job-cards/$($jcA.id)/cancel" $adminToken @{ reason = "Phase 4 verification - cleaning up test data" }
}
Write-Host "Status now: $($jcA.status) (expect CANCELLED)"

# =================== Flow B: out-of-warranty job, approval gate ===================
Write-Host "`n============ FLOW B: out-of-warranty job card, approval gate ============" -ForegroundColor Yellow
$apptB = Step "Create + complete appointment B (OUT_OF_WARRANTY, S/N out-of-range)" {
    New-CompletedAppointment "OUT_OF_WARRANTY" "SN999999" "B"
}

$jcB = Step "Create Job Card B" {
    Invoke-Api POST "/job-cards" $adminToken @{ appointmentId = $apptB.id }
}
Write-Host "Job Card $($jcB.jobCardNumber) status=$($jcB.status) warrantyStatus=$($jcB.warrantyStatus) (expect OPEN / OOW)"

$jcB = Step "Validate S/N - matches" { Invoke-Api POST "/job-cards/$($jcB.id)/validate-sn" $adminToken @{ matches = $true } }
Write-Host "Status now: $($jcB.status) (expect SN_VALIDATED)"

Expect-StatusCode "Re-validating S/N once already SN_VALIDATED should 400" 400 {
    Invoke-Api POST "/job-cards/$($jcB.id)/validate-sn" $adminToken @{ matches = $true }
}

Expect-StatusCode "Assign section before customer approval should 400 (FR-06)" 400 {
    Invoke-Api POST "/job-cards/$($jcB.id)/assign-section" $adminToken @{ section = "WORKSHOP" }
}

$jcB = Step "Record customer approval (POST /job-cards/:id/approve-customer)" {
    Invoke-Api POST "/job-cards/$($jcB.id)/approve-customer" $adminToken @{ notes = "Phase 4 verification - approved by CCE" }
}
Write-Host "customerApproved=$($jcB.customerApproved) (expect True)"

$jcB = Step "Assign section - now allowed" {
    Invoke-Api POST "/job-cards/$($jcB.id)/assign-section" $adminToken @{ section = "WORKSHOP" }
}
Write-Host "Status now: $($jcB.status), section=$($jcB.section) (expect SECTION_ASSIGNED / WORKSHOP)"

# =================== Flow C: the FR-05 creation gate ===================
Write-Host "`n============ FLOW C: Job Card creation blocked without an invoice number ============" -ForegroundColor Yellow
$apptC = Step "Create appointment C with NO invoice number" {
    Invoke-Api POST "/appointments" $adminToken @{
        type = "OUT_OF_WARRANTY"; customerType = "B2C"
        customerName = "Phase 4 C"; customerPhone = "+971501234598"
        scheduledAt = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
        serviceCentreId = $serviceCentreId
    }
}
Invoke-Api PUT "/appointments/$($apptC.id)/confirm" $adminToken $null | Out-Null

Expect-StatusCode "Create Job Card without an invoice number should 400 (FR-05)" 400 {
    Invoke-Api POST "/job-cards" $adminToken @{ appointmentId = $apptC.id }
}

Write-Host "`n=================================================="
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================="