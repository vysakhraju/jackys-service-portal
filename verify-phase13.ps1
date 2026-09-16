# Backend Phase 13 (Finance/Quality/Operational Dashboards, BRD 18.2/18.3/18.4) - live verification
#
# This can't be run from the cloud session (it has no network path to your machine), so
# run it yourself and paste the output back. It exercises the new
# /reports/finance/*, /reports/quality/*, /reports/operational/* endpoints against real
# data built through the normal API - one interdepartment (B2B_SALES_CHANNEL, in-warranty)
# job through to a POSTED Debit Note, one approved OOW job (draft/unpaid invoice, for
# revenue + aging), one rejected OOW estimate (for RWR Analysis), two jobs sharing one
# serial number within the same day (for the Repeat Complaint Report), and one AMC
# contract with a PAID billing invoice. Nothing here is invented.
#
# Because the dev DB is never reset between phases, this script's own totals will be
# ADDED ON TOP of whatever earlier phases (including your own prior warranty-claims-e2e-test.ps1
# runs) already left behind - the checks below only assert *this run's* numbers appear
# correctly (deltas / presence-in-list / structural shape), never an exact absolute total.
#
# PREREQUISITE: a technician test account, same as verify-phase3..12.ps1. If you already
# have one, fill in its email/password/id below.

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

function Assert-True($name, $condition, $detail) {
    if ($condition) {
        Write-Host "PASS: $name" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "FAIL: $name $detail" -ForegroundColor Red
        $script:fail++
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

Write-Host "Backend Phase 13 live-verification against $BaseUrl" -ForegroundColor Yellow
$suffix = (Get-Date).ToString("HHmmss")

# =====================================================================================
# 1. Auth + shared master data
# =====================================================================================
$adminLogin = Step "Admin login (POST /auth/login)" { Invoke-Api POST "/auth/login" $null @{ email = "admin@jackys.com"; password = "Admin123!" } }
$adminToken = $adminLogin.accessToken
if (-not $adminToken) { Write-Host "`nCan't continue without an admin token - stopping." -ForegroundColor Red; exit 1 }
$adminProfile = Step "Admin profile (GET /auth/profile)" { Invoke-Api GET "/auth/profile" $adminToken $null }
$adminUserId = $adminProfile.id

Write-Host "`n--- Grant admin the QC_APPROVAL permission (idempotent - 409 on rerun is expected) ---" -ForegroundColor Cyan
try {
    Invoke-Api POST "/permissions/grant" $adminToken @{ userId = $adminUserId; permissionType = "QC_APPROVAL"; notes = "Phase 13 verify script" } | Out-Null
    Write-Host "PASS: granted QC_APPROVAL to admin" -ForegroundColor Green; $pass++
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 409) { Write-Host "PASS: admin already holds QC_APPROVAL (409, expected on reruns)" -ForegroundColor Green; $pass++ }
    else { Write-Host "FAIL: Grant admin QC_APPROVAL" -ForegroundColor Red; Write-Host $_.Exception.Message -ForegroundColor Red; $fail++ }
}

$techLogin = Step "Technician login" { Invoke-Api POST "/auth/login" $null @{ email = $TechnicianEmail; password = $TechnicianPassword } }
$techToken = $techLogin.accessToken

$centre = Step "Create service centre" {
    Invoke-Api POST "/master-data/service-centres" $adminToken @{
        code = "PH13-$suffix"; name = "Phase 13 Verify Centre"; country = "UAE"; vatRate = 5
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

# One marker character 'X' inserted right after the brand prefix (WCPH13X.../WOPH13X...)
# guarantees this run's serial ranges can never be BETWEEN-matched by any pre-existing
# stale range from earlier phases/runs, same fix as warranty-claims-e2e-test.ps1's
# collision fix (Postgres BETWEEN on text is byte-wise lexicographic, not numeric).
Step "Create warranty master entry (IW range for the interdepartment job)" {
    Invoke-Api POST "/master-data/warranty-master" $adminToken @{
        serialNumberRange = "WCPH13X${suffix}0000-WCPH13X${suffix}9999"; brand = "Samsung"; model = "WA80J5710"
        warrantyPeriodMonths = 24; supplier = "Samsung Gulf"
    }
} | Out-Null

$faultCode = "F-PH13-$suffix"
$symptomCode = "S-PH13-$suffix"
Step "Create fault/symptom" {
    Invoke-Api POST "/master-data/fault-symptoms" $adminToken @{
        faultCode = $faultCode; faultDescription = "Phase 13 test fault"
        symptomCode = $symptomCode; symptomDescription = "Phase 13 test symptom"
        category = "WASHING_MACHINE"
    }
} | Out-Null

# Model-SPECIFIC (not the model-agnostic default) so resolveLaborCost() matches this row
# ahead of any leftover default REPAIR row from an earlier phase's own test data - the dev
# DB is never reset, and a stale default row with a different rate would make this run's
# laborCost assertion below flaky.
Step "Create model-specific REPAIR price list row for WA80J5710 (interdepartmentLaborCost)" {
    Invoke-Api POST "/master-data/price-lists" $adminToken @{
        activityType = "REPAIR"; modelId = "WA80J5710"; priceB2B = 300; priceB2C = 350
        warrantyLaborCost = 80; interdepartmentLaborCost = 60; currency = "AED"; isActive = $true
    }
} | Out-Null

# Reusable job-card builder (mirrors verify-phase9.ps1's New-QcPassedJobCard, extended
# with the B2B_SALES_CHANNEL+IW interdepartment path that only Phase 13 needs).
function New-QcPassedJobCard($faultCode, $symptomCode, $serialNumber, $label, $isOow, $customerType, $customerPhone, $lineItemAmount, $approveEstimate) {
    $appt = Step "[$label] Create appointment ($customerType, $(if ($isOow) {'OOW'} else {'IW'}))" {
        Invoke-Api POST "/appointments" $adminToken @{
            type = "WARRANTY"; customerType = $customerType
            customerName = "Phase 13 Test Customer ($label)"; customerPhone = $customerPhone; customerEmail = "phase13-$label@example.com"
            brand = "Samsung"; modelNumber = "WA80J5710"; serialNumber = $serialNumber
            problemDescription = "Phase 13 test issue ($label)"
            invoiceNumber = "INV-PH13-$label"
            scheduledAt = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
            serviceCentreId = $script:serviceCentreId
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
    Write-Host "warrantyStatus=$($jc.warrantyStatus) (expect $(if ($isOow) {'OOW'} else {'IW'}))"
    Step "[$label] Validate S/N" { Invoke-Api POST "/job-cards/$jobCardId/validate-sn" $adminToken @{ matches = $true } } | Out-Null

    if ($isOow) {
        Step "[$label] Approve customer (FR-06, required before assign-section for OOW)" {
            Invoke-Api POST "/job-cards/$jobCardId/approve-customer" $adminToken @{ notes = "Phase 13 verify - customer authorized diagnosis/repair" }
        } | Out-Null
        $estimate = Step "[$label] Create Estimate" {
            Invoke-Api POST "/estimates" $adminToken @{ jobCardId = $jobCardId; lineItems = @(@{ description = "Phase 13 repair ($label)"; quantity = 1; unitPrice = $lineItemAmount }) }
        }
        Step "[$label] Send Estimate" { Invoke-Api POST "/estimates/$($estimate.id)/send" $adminToken $null } | Out-Null
        if ($approveEstimate) {
            Step "[$label] Staff-record customer APPROVAL" {
                Invoke-Api POST "/estimates/$($estimate.id)/record-response" $adminToken @{ approved = $true; contactMethod = "PHONE_CALL"; contactValue = $customerPhone; notes = "Phase 13 verify - approved by phone" }
            } | Out-Null
        } else {
            Step "[$label] Staff-record customer REJECTION (for RWR Analysis)" {
                Invoke-Api POST "/estimates/$($estimate.id)/record-response" $adminToken @{ approved = $false; contactMethod = "PHONE_CALL"; contactValue = $customerPhone; notes = "Price too high" }
            } | Out-Null
            Write-Host "[$label] Job Card left in RWR status on purpose - not carried through to QC." -ForegroundColor Yellow
            return $jobCardId
        }
    }

    Step "[$label] Assign section = WORKSHOP" { Invoke-Api POST "/job-cards/$jobCardId/assign-section" $adminToken @{ section = "WORKSHOP" } } | Out-Null
    Step "[$label] Assign workshop technician" { Invoke-Api POST "/workshop/$jobCardId/assign" $adminToken @{ technicianId = $TechnicianId } } | Out-Null
    Step "[$label] Start WIP" { Invoke-Api POST "/workshop/$jobCardId/start-wip" $adminToken $null } | Out-Null
    Step "[$label] Complete workshop work (no spares needed)" { Invoke-Api POST "/workshop/$jobCardId/complete" $adminToken $null } | Out-Null
    $approved = Step "[$label] QC approve" { Invoke-Api POST "/job-cards/$jobCardId/qc/approve" $adminToken $null }
    Write-Host "status=$($approved.status) (expect QC_PASSED)"
    return $jobCardId
}

# =====================================================================================
# 2. Build test data
# =====================================================================================

# 2a. Interdepartment (B2B_SALES_CHANNEL, IW) job -> Debit Note -> POSTED
$jcInterdept = New-QcPassedJobCard $faultCode $symptomCode "WCPH13X${suffix}0001" "interdept" $false "B2B_SALES_CHANNEL" "+971509990001" 0 $true
$debitNote = Step "[interdept] Get/create Debit Note (GET /debit-notes/job-card/:id)" { Invoke-Api GET "/debit-notes/job-card/$jcInterdept" $adminToken $null }
Write-Host "Debit Note: status=$($debitNote.status) laborCost=$($debitNote.laborCost) totalAmount=$($debitNote.totalAmount)"
Assert-True "Debit Note laborCost matches the price list's interdepartmentLaborCost (60)" ($debitNote.laborCost -eq 60) "(got $($debitNote.laborCost))"
$debitNotePosted = Step "[interdept] Post the Debit Note" { Invoke-Api POST "/debit-notes/$($debitNote.id)/post" $adminToken $null }
Assert-True "Debit Note is now POSTED" ($debitNotePosted.status -eq "POSTED") "(got $($debitNotePosted.status))"

# 2b. OOW job, approved, fresh unpaid invoice (revenue + Unpaid Invoices aging, 0-2 day bucket)
$jcOowFresh = New-QcPassedJobCard $faultCode $symptomCode "SNPH13${suffix}0002" "oow-fresh" $true "B2C" "+971509990002" 280 $true
$oowInvoice = Step "[oow-fresh] Get/create OOW Invoice (GET /invoicing/job-card/:id)" { Invoke-Api GET "/invoicing/job-card/$jcOowFresh" $adminToken $null }
Write-Host "Invoice: number=$($oowInvoice.invoiceNumber) amount=$($oowInvoice.amount) status=$($oowInvoice.status)"

# 2c. OOW job, rejected (RWR Analysis - reason = "Price too high")
$jcRwr = New-QcPassedJobCard $faultCode $symptomCode "SNPH13${suffix}0003" "rwr" $true "B2C" "+971509990003" 999 $false

# 2d. Repeat complaint pair - two job cards sharing one serial number, both created today.
$repeatSerial = "SNPH13${suffix}RPT"
function New-MinimalJobCard($serialNumber, $label) {
    $appt = Step "[$label] Create appointment" {
        Invoke-Api POST "/appointments" $adminToken @{
            type = "WARRANTY"; customerType = "B2C"
            customerName = "Phase 13 Repeat Test ($label)"; customerPhone = "+9715099900$($label.Substring($label.Length-1))"
            brand = "Samsung"; modelNumber = "WA80J5710"; serialNumber = $serialNumber
            problemDescription = "Phase 13 repeat-complaint test ($label)"
            invoiceNumber = "INV-PH13-RPT-$label"
            scheduledAt = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
            serviceCentreId = $script:serviceCentreId
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
    return $jc.id
}
$jcRepeat1 = New-MinimalJobCard $repeatSerial "repeat1"
$jcRepeat2 = New-MinimalJobCard $repeatSerial "repeat2"

# 2e. AMC contract + PAID billing invoice (AMC revenue + Active Contracts Count)
$amcContract = Step "Create AMC contract" {
    Invoke-Api POST "/amc/contracts" $adminToken @{
        customerName = "Phase 13 AMC Customer"; customerPhone = "+971509990099"; customerType = "B2C"
        serviceCentreId = $serviceCentreId; coveredSerialNumbers = @("AMCPH13-$suffix")
        coverageType = "COMPREHENSIVE"; visitFrequency = "QUARTERLY"
        startDate = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ"); endDate = (Get-Date).AddYears(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
        totalAmount = 1200; paymentTerms = "FULL_UPFRONT"
    }
}
$amcBillingInvoice = Step "Generate AMC billing invoice" { Invoke-Api POST "/amc/contracts/$($amcContract.id)/billing-invoices" $adminToken @{ periodLabel = "Full Term" } }
Step "Record full payment against AMC billing invoice" { Invoke-Api POST "/amc/billing-invoices/$($amcBillingInvoice.id)/record-payment" $adminToken @{ method = "BANK_TRANSFER"; reference = "PH13-AMC-PAY" } } | Out-Null

# =====================================================================================
# 3. Role gating - Finance is narrower than Quality/Operational (no TECHNICIAN_FIELD anywhere)
# =====================================================================================
Expect-StatusCode "Technician CANNOT reach /reports/finance/summary" 403 { Invoke-Api GET "/reports/finance/summary" $techToken $null }
Expect-StatusCode "Technician CANNOT reach /reports/quality/repeat-complaints" 403 { Invoke-Api GET "/reports/quality/repeat-complaints" $techToken $null }
Expect-StatusCode "Technician CANNOT reach /reports/operational/sla-breach" 403 { Invoke-Api GET "/reports/operational/sla-breach" $techToken $null }

# =====================================================================================
# 4. Finance Dashboard (18.2)
# =====================================================================================
$financeSummary = Step "GET /reports/finance/summary" { Invoke-Api GET "/reports/finance/summary" $adminToken $null }
Write-Host "revenueSummary.totalServiceRevenue=$($financeSummary.revenueSummary.totalServiceRevenue) revenueSummary.totalAmcRevenue=$($financeSummary.revenueSummary.totalAmcRevenue)"
Write-Host "costSummary.totalCOGS=$($financeSummary.costSummary.totalCOGS) profitSummary.grossProfit=$($financeSummary.profitSummary.grossProfit)"
Write-Host "warranty.totalLabourCostIw=$($financeSummary.warranty.totalLabourCostIw) warranty.totalSpareCostIw=$($financeSummary.warranty.totalSpareCostIw)"
Write-Host "amc.activeContractsCount=$($financeSummary.amc.activeContractsCount) amc.totalAmcRevenue=$($financeSummary.amc.totalAmcRevenue)"
Assert-True "costSummary.totalCOGS is null (never fabricated)" ($null -eq $financeSummary.costSummary.totalCOGS) "(got $($financeSummary.costSummary.totalCOGS))"
Assert-True "profitSummary.grossProfit is null" ($null -eq $financeSummary.profitSummary.grossProfit) "(got $($financeSummary.profitSummary.grossProfit))"
Assert-True "oow.totalLabourCostOow is null (never warrantyLaborCost-derived)" ($null -eq $financeSummary.oow.totalLabourCostOow) "(got $($financeSummary.oow.totalLabourCostOow))"
Assert-True "amc.totalAmcLabourCost is null" ($null -eq $financeSummary.amc.totalAmcLabourCost) "(got $($financeSummary.amc.totalAmcLabourCost))"
Assert-True "warranty.totalLabourCostIw includes this run's Debit Note (>= 60)" ($financeSummary.warranty.totalLabourCostIw -ge 60) "(got $($financeSummary.warranty.totalLabourCostIw))"
Assert-True "amc.activeContractsCount includes this run's contract (>= 1)" ($financeSummary.amc.activeContractsCount -ge 1) "(got $($financeSummary.amc.activeContractsCount))"
Assert-True "amc.totalAmcRevenue includes this run's PAID invoice (>= 1200)" ($financeSummary.amc.totalAmcRevenue -ge 1200) "(got $($financeSummary.amc.totalAmcRevenue))"
Assert-True "revenueSummary.totalServiceRevenue includes this run's OOW invoice (>= 280)" ($financeSummary.revenueSummary.totalServiceRevenue -ge 280) "(got $($financeSummary.revenueSummary.totalServiceRevenue))"

$interdept = Step "GET /reports/finance/interdepartment-recharge" { Invoke-Api GET "/reports/finance/interdepartment-recharge" $adminToken $null }
$ourChannel = $interdept | Where-Object { $_.salesChannelName -eq "Phase 13 Test Customer (interdept)" }
Assert-True "Interdepartment Recharge Summary includes our sales channel with 1 POSTED job" ($ourChannel -and $ourChannel.postedToGlCount -ge 1) "(row: $($ourChannel | ConvertTo-Json -Compress))"

$unpaid = Step "GET /reports/finance/unpaid-invoices" { Invoke-Api GET "/reports/finance/unpaid-invoices" $adminToken $null }
$ourInvoice = $unpaid.b2c | Where-Object { $_.invoiceNumber -eq $oowInvoice.invoiceNumber }
Assert-True "Unpaid Invoices (B2C) lists our fresh invoice in the 0-2 days bucket" ($ourInvoice -and $ourInvoice.agingBucket -eq "0-2 days") "(row: $($ourInvoice | ConvertTo-Json -Compress))"
Assert-True "Unpaid Invoices B2B and B2C arrays are reported separately (both present on the response)" (($unpaid.PSObject.Properties.Name -contains "b2b") -and ($unpaid.PSObject.Properties.Name -contains "b2c")) ""

$gpByCentre = Step "GET /reports/finance/gp-by-service-centre" { Invoke-Api GET "/reports/finance/gp-by-service-centre" $adminToken $null }
$ourCentreRow = $gpByCentre | Where-Object { $_.serviceCentreId -eq $serviceCentreId }
Assert-True "GP by Service Centre has a row for our centre with grossProfit null and no overhead field" ($ourCentreRow -and $null -eq $ourCentreRow.grossProfit -and -not ($ourCentreRow.PSObject.Properties.Name -contains "overhead")) "(row: $($ourCentreRow | ConvertTo-Json -Compress))"

$profitTrend = Step "GET /reports/finance/profit-trend?groupBy=month" { Invoke-Api GET "/reports/finance/profit-trend?groupBy=month" $adminToken $null }
Assert-True "Profit Trend returns at least one bucket with totalCOGS null" (($profitTrend.Count -ge 1) -and ($null -eq $profitTrend[0].totalCOGS)) "(count=$($profitTrend.Count))"

# =====================================================================================
# 5. Quality Dashboard (18.3)
# =====================================================================================
$failureRatio = Step "GET /reports/quality/product-failure-ratio?modelNumber=WA80J5710" { Invoke-Api GET "/reports/quality/product-failure-ratio?modelNumber=WA80J5710" $adminToken $null }
Assert-True "Product Failure Ratio returns at least one row for WA80J5710 this run created" ($failureRatio.Count -ge 1) "(count=$($failureRatio.Count))"

$repeatComplaints = Step "GET /reports/quality/repeat-complaints" { Invoke-Api GET "/reports/quality/repeat-complaints" $adminToken $null }
$ourRepeat = $repeatComplaints | Where-Object { $_.serialNumber -eq $repeatSerial }
Assert-True "Repeat Complaint Report flags our same-day two-job serial number" ($ourRepeat -and $ourRepeat.repeatWithin30Days -and $ourRepeat.totalJobCount -eq 2) "(row: $($ourRepeat | ConvertTo-Json -Compress))"

$rwr = Step "GET /reports/quality/rwr-analysis" { Invoke-Api GET "/reports/quality/rwr-analysis" $adminToken $null }
$ourRwr = $rwr | Where-Object { $_.reason -eq "Price too high" -and $_.model -eq "WA80J5710" }
Assert-True "RWR Analysis includes our rejected estimate under reason 'Price too high'" ($ourRwr -and $ourRwr.count -ge 1) "(row: $($ourRwr | ConvertTo-Json -Compress))"

# =====================================================================================
# 6. Operational Reports (18.4)
# =====================================================================================
$productivity = Step "GET /reports/operational/technician-productivity" { Invoke-Api GET "/reports/operational/technician-productivity" $adminToken $null }
$ourTech = $productivity.rows | Where-Object { $_.technicianId -eq $TechnicianId }
Assert-True "Technician Productivity has a row for our technician with jobsCompleted >= 2 (interdept + oow-fresh) and no customerRating field" ($ourTech -and $ourTech.jobsCompleted -ge 2 -and -not ($ourTech.PSObject.Properties.Name -contains "customerRating")) "(row: $($ourTech | ConvertTo-Json -Compress))"

$slaBreach = Step "GET /reports/operational/sla-breach" { Invoke-Api GET "/reports/operational/sla-breach" $adminToken $null }
Assert-True "SLA Breach Report responds with thresholdHours=48 by default" ($slaBreach.thresholdHours -eq 48) "(got $($slaBreach.thresholdHours))"

$spareConsumption = Step "GET /reports/operational/spare-parts-consumption" { Invoke-Api GET "/reports/operational/spare-parts-consumption" $adminToken $null }
Assert-True "Spare Parts Consumption responds with the expected top10/byModel/byWarrantyStatus shape" (
    ($spareConsumption.PSObject.Properties.Name -contains "topByQuantity") -and
    ($spareConsumption.PSObject.Properties.Name -contains "topByValue") -and
    ($spareConsumption.PSObject.Properties.Name -contains "byModel") -and
    ($spareConsumption.PSObject.Properties.Name -contains "byWarrantyStatus")
) ""

# =====================================================================================
Write-Host "`n=== Backend Phase 13 (Finance/Quality/Operational Dashboards) verification complete ===" -ForegroundColor Yellow
Write-Host "PASS: $pass  FAIL: $fail" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
if ($fail -gt 0) { exit 1 }
