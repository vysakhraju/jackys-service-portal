# Frontend Phase 10 (AMC Management) - live verification
#
# This can't be run from the cloud session (it has no network path to your machine), so
# run it yourself and paste the output back. It exercises the exact endpoints
# ContractsPage.tsx / CompleteVisitModal.tsx / AmcBillingSection.tsx / ExpiringContractsPage.tsx
# / UpsellCandidatesPage.tsx send, plus the two backend guards added after this phase's
# the-fool pre-mortem:
#   1. Contract creation + its auto-generated PM visit schedule, and the 60-visit safety cap.
#   2. The generic PUT /appointments/:id/complete now REJECTS an AMC-type appointment -
#      the fix for pre-mortem finding #1 (a technician could otherwise silently lose a PM
#      visit's checklist/signature/extra-charge record forever).
#   3. AMC visit completion itself, including the extra-charge-requires-approval guard.
#   4. AMC billing invoice generation now REJECTS a duplicate non-cancelled periodLabel on
#      the same contract - the fix for pre-mortem finding #3 - plus full-amount-only
#      payment and the B2B-Credit-requires-B2B-contract guard.
#   5. Renewal (forward-only chain, original marked RENEWED, re-renewal blocked).
#   6. Cancellation, including the cascade that cancels future SCHEDULED PM visits.
#   7. The expiring-contracts query + manual send-renewal-reminder trigger.
#   8. The upsell-candidates heuristic, including that an existing ACTIVE AMC contract on
#      the same phone number correctly excludes a customer from the list.
#
# Note: AmcBillingStatus has a CANCELLED value but nothing in the current API ever sets
# it (only AmcService.amc.service.spec.ts exercises that path with a mocked repository) -
# so the "duplicate periodLabel is allowed again once the prior invoice for it is
# cancelled" branch genuinely can't be exercised live yet and is skipped here, not
# forgotten.
#
# PREREQUISITE: a technician test account, same as verify-phase3..9.ps1. If you already
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

# Identical to Phase 8/9's helper - builds one job card from a fresh appointment through to
# QC_PASSED, no spares requested, handling the OOW Estimate+customer-approval lifecycle in
# between. Reused here only for Part G (upsell candidates), which needs a real APPROVED
# Estimate on an OOW job card to produce a candidate.
function New-QcPassedJobCard($serviceCentreId, $faultCode, $symptomCode, $serialNumber, $label, $isOow, $customerType, $customerPhone, $lineItemAmount) {
    $appt = Step "[$label] Create appointment ($customerType, $(if ($isOow) {'OOW'} else {'IW'}) serial)" {
        Invoke-Api POST "/appointments" $adminToken @{
            type = "WARRANTY"; customerType = $customerType
            customerName = "Phase 10 Test Customer ($label)"; customerPhone = $customerPhone; customerEmail = "phase10-$label@example.com"
            brand = "Samsung"; modelNumber = "WA80J5710"; serialNumber = $serialNumber
            problemDescription = "Phase 10 test issue ($label)"
            invoiceNumber = "INV-PH10-$label"
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
    Write-Host "warrantyStatus=$($jc.warrantyStatus) (expect $(if ($isOow) {'OOW'} else {'IW'}))"
    Step "[$label] Validate S/N" { Invoke-Api POST "/job-cards/$jobCardId/validate-sn" $adminToken @{ matches = $true } } | Out-Null

    if ($isOow) {
        Step "[$label] Approve customer (FR-06, required before assign-section for OOW)" {
            Invoke-Api POST "/job-cards/$jobCardId/approve-customer" $adminToken @{ notes = "Phase 10 verify - customer authorized diagnosis/repair to proceed" }
        } | Out-Null
        $estimate = Step "[$label] Create Estimate (POST /estimates)" {
            Invoke-Api POST "/estimates" $adminToken @{
                jobCardId = $jobCardId
                lineItems = @(@{ description = "Phase 10 repair ($label)"; quantity = 1; unitPrice = $lineItemAmount })
            }
        }
        Step "[$label] Send Estimate" { Invoke-Api POST "/estimates/$($estimate.id)/send" $adminToken $null } | Out-Null
        Step "[$label] Staff-record customer approval" {
            Invoke-Api POST "/estimates/$($estimate.id)/record-response" $adminToken @{
                approved = $true; contactMethod = "PHONE_CALL"; contactValue = $customerPhone
                notes = "Phase 10 verify - customer approved by phone"
            }
        } | Out-Null
    }

    Step "[$label] Assign section = WORKSHOP" { Invoke-Api POST "/job-cards/$jobCardId/assign-section" $adminToken @{ section = "WORKSHOP" } } | Out-Null
    Step "[$label] Assign workshop technician" { Invoke-Api POST "/workshop/$jobCardId/assign" $adminToken @{ technicianId = $TechnicianId } } | Out-Null
    Step "[$label] Start WIP" { Invoke-Api POST "/workshop/$jobCardId/start-wip" $adminToken $null } | Out-Null
    Step "[$label] Complete workshop work (no spares needed)" { Invoke-Api POST "/workshop/$jobCardId/complete" $adminToken $null } | Out-Null
    $approved = Step "[$label] QC approve (POST /job-cards/:id/qc/approve)" { Invoke-Api POST "/job-cards/$jobCardId/qc/approve" $adminToken $null }
    Write-Host "status=$($approved.status) (expect QC_PASSED)"
    return @{ jobCardId = $jobCardId; estimateAmount = $estimate.totalAmount }
}

Write-Host "Frontend Phase 10 live-verification against $BaseUrl" -ForegroundColor Yellow
$suffix = (Get-Date).ToString("HHmmss")

# 0. Admin login + idempotent self-grant of QC_APPROVAL (needed for New-QcPassedJobCard's
# own qc/approve step in Part G - a 409 on rerun is expected, not a real failure).
$adminLogin = Step "Admin login (POST /auth/login)" { Invoke-Api POST "/auth/login" $null @{ email = "admin@jackys.com"; password = "Admin123!" } }
$adminToken = $adminLogin.accessToken
if (-not $adminToken) { Write-Host "`nCan't continue without an admin token - stopping." -ForegroundColor Red; exit 1 }
$adminProfile = Step "Admin profile (GET /auth/profile)" { Invoke-Api GET "/auth/profile" $adminToken $null }
$adminUserId = $adminProfile.id

Write-Host "`n--- Grant admin the QC_APPROVAL permission (POST /permissions/grant) ---" -ForegroundColor Cyan
try {
    Invoke-Api POST "/permissions/grant" $adminToken @{ userId = $adminUserId; permissionType = "QC_APPROVAL"; notes = "Phase 10 verify script" } | Out-Null
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

# 1. Master data - one 5% VAT service centre, one fault/symptom pair (needed by
# New-QcPassedJobCard in Part G).
$centre = Step "Create service centre (POST /master-data/service-centres)" {
    Invoke-Api POST "/master-data/service-centres" $adminToken @{
        code = "PH10-$suffix"; name = "Phase 10 Verify Centre"; country = "UAE"; vatRate = 5
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

$faultCode = "F-PH10-$suffix"
$symptomCode = "S-PH10-$suffix"
Step "Create fault/symptom (POST /master-data/fault-symptoms)" {
    Invoke-Api POST "/master-data/fault-symptoms" $adminToken @{
        faultCode = $faultCode; faultDescription = "Phase 10 test fault"
        symptomCode = $symptomCode; symptomDescription = "Phase 10 test symptom"
        category = "WASHING_MACHINE"
    }
} | Out-Null

# =====================================================================================
# PART A - Contract creation + auto-generated PM visit schedule + the 60-visit safety cap
# =====================================================================================

$contractA = Step "Create AMC contract A (QUARTERLY, 12mo range -> expect 5 generated visits)" {
    Invoke-Api POST "/amc/contracts" $adminToken @{
        customerName = "Phase 10 Contract A Customer"; customerPhone = "+9715088${suffix}0"
        customerType = "B2C"; serviceCentreId = $serviceCentreId
        coveredSerialNumbers = @("SN-PH10-A1", "SN-PH10-A2")
        coverageType = "COMPREHENSIVE"; visitFrequency = "QUARTERLY"
        startDate = "2026-09-01T00:00:00.000Z"; endDate = "2027-09-01T00:00:00.000Z"
        totalAmount = 4800.0; paymentTerms = "QUARTERLY"
    }
}
Write-Host "contractNumber=$($contractA.contractNumber) status=$($contractA.status) (expect ACTIVE)"

$scheduleA = Step "GET /amc/contracts/:id/schedule for contract A" { Invoke-Api GET "/amc/contracts/$($contractA.id)/schedule" $adminToken $null }
$allAmcType = -not ($scheduleA | Where-Object { $_.type -ne "AMC" })
$allScheduled = -not ($scheduleA | Where-Object { $_.status -ne "SCHEDULED" })
$allLinked = -not ($scheduleA | Where-Object { $_.amcContractId -ne $contractA.id })
Write-Host "generated visit count=$($scheduleA.Count) (expect 5) all type=AMC:$allAmcType all SCHEDULED:$allScheduled all linked to contract A:$allLinked"

Expect-StatusCode "Create AMC contract with MONTHLY over 7 years is rejected for exceeding the 60-visit cap" 400 {
    Invoke-Api POST "/amc/contracts" $adminToken @{
        customerName = "Phase 10 Cap Test"; customerPhone = "+9715088${suffix}9"
        customerType = "B2C"; serviceCentreId = $serviceCentreId
        coveredSerialNumbers = @("SN-PH10-CAP")
        coverageType = "COMPREHENSIVE"; visitFrequency = "MONTHLY"
        startDate = "2020-01-01T00:00:00.000Z"; endDate = "2027-01-01T00:00:00.000Z"
        totalAmount = 10000.0; paymentTerms = "FULL_UPFRONT"
    }
}

$byNumber = Step "GET /amc/contracts/number/:contractNumber" { Invoke-Api GET "/amc/contracts/number/$($contractA.contractNumber)" $adminToken $null }
Write-Host "found by number: id matches=$($byNumber.id -eq $contractA.id) (expect True)"

# =====================================================================================
# PART B - the generic complete endpoint now rejects an AMC-type appointment, and the
# AMC module's own completion flow (checklist/signature/extra-charge) works correctly.
# =====================================================================================

$visit1 = $scheduleA[0]
$visit2 = $scheduleA[1]

Step "[visit 1] Assign technician" { Invoke-Api PUT "/appointments/$($visit1.id)/assign-technician" $adminToken @{ technicianId = $TechnicianId } } | Out-Null
Step "[visit 1] Mark on-site (PUT /appointments/:id/on-site)" { Invoke-Api PUT "/appointments/$($visit1.id)/on-site" $adminToken $null } | Out-Null

Expect-StatusCode "[visit 1] Generic PUT /appointments/:id/complete rejects an AMC-type ON_SITE appointment (pre-mortem finding #1 fix)" 400 {
    Invoke-Api PUT "/appointments/$($visit1.id)/complete" $adminToken $null
}

$completion1 = Step "[visit 1] Complete via POST /amc/visits/:appointmentId/complete (no extra charge)" {
    Invoke-Api POST "/amc/visits/$($visit1.id)/complete" $adminToken @{
        checklistNotes = "Filter cleaned, drum inspected, no issues found."
    }
}
Write-Host "visitNumber=$($completion1.visitNumber) extraChargeAmount=$($completion1.extraChargeAmount) (expect 1, null)"

$fetchedCompletion1 = Step "GET /amc/visits/:appointmentId/completion for visit 1" { Invoke-Api GET "/amc/visits/$($visit1.id)/completion" $adminToken $null }
Write-Host "fetched completion id matches=$($fetchedCompletion1.id -eq $completion1.id) (expect True)"

Expect-StatusCode "[visit 1] Completing the same visit a second time is rejected" 400 {
    Invoke-Api POST "/amc/visits/$($visit1.id)/complete" $adminToken @{ checklistNotes = "duplicate attempt" }
}

Step "[visit 2] Assign technician" { Invoke-Api PUT "/appointments/$($visit2.id)/assign-technician" $adminToken @{ technicianId = $TechnicianId } } | Out-Null
Step "[visit 2] Mark on-site" { Invoke-Api PUT "/appointments/$($visit2.id)/on-site" $adminToken $null } | Out-Null

Expect-StatusCode "[visit 2] An extra charge without extraChargeApprovedByCustomer=true is rejected" 400 {
    Invoke-Api POST "/amc/visits/$($visit2.id)/complete" $adminToken @{
        checklistNotes = "Compressor needs a part not covered by AMC."
        extraChargeDescription = "Non-covered compressor part"
        extraChargeAmount = 150.0
    }
}

$completion2 = Step "[visit 2] Complete with an approved extra charge" {
    Invoke-Api POST "/amc/visits/$($visit2.id)/complete" $adminToken @{
        checklistNotes = "Compressor needs a part not covered by AMC."
        extraChargeDescription = "Non-covered compressor part"
        extraChargeAmount = 150.0
        extraChargeApprovedByCustomer = $true
    }
}
Write-Host "visitNumber=$($completion2.visitNumber) extraChargeAmount=$($completion2.extraChargeAmount) approved=$($completion2.extraChargeApprovedByCustomer) (expect 2, 150, True)"

# =====================================================================================
# PART C - Billing invoices: duplicate-periodLabel guard, full-amount-only payment, and
# the B2B-Credit-requires-B2B-contract guard.
# =====================================================================================

$invoiceQ1 = Step "Generate billing invoice for contract A, periodLabel 'Q1 2026'" {
    Invoke-Api POST "/amc/contracts/$($contractA.id)/billing-invoices" $adminToken @{ periodLabel = "Q1 2026" }
}
Write-Host "invoiceNumber=$($invoiceQ1.invoiceNumber) amount=$($invoiceQ1.amount) status=$($invoiceQ1.status) (expect 1200 = 4800/4 installments, DRAFT)"

Expect-StatusCode "A second invoice for the same periodLabel 'Q1 2026' on the same contract is rejected (pre-mortem finding #3 fix)" 400 {
    Invoke-Api POST "/amc/contracts/$($contractA.id)/billing-invoices" $adminToken @{ periodLabel = "Q1 2026" }
}

$invoiceQ2 = Step "A different periodLabel 'Q2 2026' on the same contract is allowed" {
    Invoke-Api POST "/amc/contracts/$($contractA.id)/billing-invoices" $adminToken @{ periodLabel = "Q2 2026" }
}

$invoicesForA = Step "GET /amc/contracts/:id/billing-invoices lists both" { Invoke-Api GET "/amc/contracts/$($contractA.id)/billing-invoices" $adminToken $null }
Write-Host "invoice count for contract A=$($invoicesForA.Count) (expect 2)"

Expect-StatusCode "recordBillingPayment with B2B_CREDIT is rejected against contract A (B2C, not B2B)" 403 {
    Invoke-Api POST "/amc/billing-invoices/$($invoiceQ2.id)/record-payment" $adminToken @{ method = "B2B_CREDIT" }
}

$paidQ1 = Step "Record full-amount payment (CASH) on the Q1 invoice" {
    Invoke-Api POST "/amc/billing-invoices/$($invoiceQ1.id)/record-payment" $adminToken @{ method = "CASH"; reference = "Phase 10 verify" }
}
Write-Host "status=$($paidQ1.status) paymentMethod=$($paidQ1.paymentMethod) (expect PAID, CASH)"

Expect-StatusCode "Recording payment again on an already-PAID invoice is rejected" 400 {
    Invoke-Api POST "/amc/billing-invoices/$($invoiceQ1.id)/record-payment" $adminToken @{ method = "CASH" }
}

Step "Record full-amount payment (BANK_TRANSFER) on the Q2 invoice" {
    Invoke-Api POST "/amc/billing-invoices/$($invoiceQ2.id)/record-payment" $adminToken @{ method = "BANK_TRANSFER" }
} | Out-Null

# A separate small B2B contract, purely to prove B2B_CREDIT is accepted once the contract
# actually IS B2B (the positive side of the guard tested above).
$contractB2b = Step "Create a small B2B AMC contract (FULL_UPFRONT, 1 visit)" {
    Invoke-Api POST "/amc/contracts" $adminToken @{
        customerName = "Phase 10 B2B Customer LLC"; customerPhone = "+9715088${suffix}1"
        customerType = "B2B"; serviceCentreId = $serviceCentreId
        coveredSerialNumbers = @("SN-PH10-B2B-1")
        coverageType = "LABOR_ONLY"; visitFrequency = "HALF_YEARLY"
        startDate = "2026-09-01T00:00:00.000Z"; endDate = "2027-02-01T00:00:00.000Z"
        totalAmount = 2400.0; paymentTerms = "FULL_UPFRONT"
    }
}
$invoiceB2b = Step "Generate billing invoice for the B2B contract" {
    Invoke-Api POST "/amc/contracts/$($contractB2b.id)/billing-invoices" $adminToken @{ periodLabel = "Full Term" }
}
$paidB2b = Step "Record payment with B2B_CREDIT succeeds against a real B2B contract" {
    Invoke-Api POST "/amc/billing-invoices/$($invoiceB2b.id)/record-payment" $adminToken @{ method = "B2B_CREDIT"; reference = "PO-PH10-$suffix" }
}
Write-Host "status=$($paidB2b.status) paymentMethod=$($paidB2b.paymentMethod) (expect PAID, B2B_CREDIT)"

# =====================================================================================
# PART D - Renewal: forward-only chain, original marked RENEWED, re-renewal blocked.
# =====================================================================================

$renewed = Step "Renew contract A (new dates/amount, frequency/paymentTerms omitted -> inherited)" {
    Invoke-Api POST "/amc/contracts/$($contractA.id)/renew" $adminToken @{
        startDate = "2027-09-01T00:00:00.000Z"; endDate = "2028-08-31T00:00:00.000Z"
        totalAmount = 5000.0
    }
}
Write-Host "new contractNumber=$($renewed.contractNumber) previousContractId matches=$($renewed.previousContractId -eq $contractA.id) inherited visitFrequency=$($renewed.visitFrequency) (expect True, QUARTERLY)"

$contractAAfter = Step "GET contract A again - should now be RENEWED, not ACTIVE" { Invoke-Api GET "/amc/contracts/$($contractA.id)" $adminToken $null }
Write-Host "status=$($contractAAfter.status) (expect RENEWED)"

Expect-StatusCode "Renewing contract A a second time is rejected (already RENEWED)" 400 {
    Invoke-Api POST "/amc/contracts/$($contractA.id)/renew" $adminToken @{ startDate = "2028-09-01T00:00:00.000Z"; endDate = "2029-08-31T00:00:00.000Z"; totalAmount = 5200.0 }
}

# =====================================================================================
# PART E - Cancellation, including the cascade that cancels future SCHEDULED PM visits.
# =====================================================================================

$contractC = Step "Create contract C (MONTHLY, short range, purely for the cancellation cascade test)" {
    Invoke-Api POST "/amc/contracts" $adminToken @{
        customerName = "Phase 10 Contract C Customer"; customerPhone = "+9715088${suffix}2"
        customerType = "B2C"; serviceCentreId = $serviceCentreId
        coveredSerialNumbers = @("SN-PH10-C1")
        coverageType = "COMPREHENSIVE"; visitFrequency = "MONTHLY"
        startDate = "2026-09-01T00:00:00.000Z"; endDate = "2026-12-01T00:00:00.000Z"
        totalAmount = 1200.0; paymentTerms = "FULL_UPFRONT"
    }
}
$scheduleCBefore = Step "GET schedule for contract C before cancellation" { Invoke-Api GET "/amc/contracts/$($contractC.id)/schedule" $adminToken $null }
Write-Host "visit count=$($scheduleCBefore.Count) all SCHEDULED=$(-not ($scheduleCBefore | Where-Object { $_.status -ne 'SCHEDULED' })) (expect 4, True)"

$cancelledC = Step "Cancel contract C" { Invoke-Api POST "/amc/contracts/$($contractC.id)/cancel" $adminToken @{ reason = "Phase 10 verify - customer relocating" } }
Write-Host "status=$($cancelledC.status) cancellationReason=$($cancelledC.cancellationReason) (expect CANCELLED)"

$scheduleCAfter = Step "GET schedule for contract C after cancellation - every visit should now be CANCELLED" { Invoke-Api GET "/amc/contracts/$($contractC.id)/schedule" $adminToken $null }
$allCancelled = -not ($scheduleCAfter | Where-Object { $_.status -ne "CANCELLED" })
Write-Host "all $($scheduleCAfter.Count) visits now CANCELLED: $allCancelled (expect True)"

Expect-StatusCode "Cancelling contract C again is rejected (no longer ACTIVE)" 400 {
    Invoke-Api POST "/amc/contracts/$($contractC.id)/cancel" $adminToken @{ reason = "second attempt" }
}
Expect-StatusCode "Renewing a CANCELLED contract is rejected" 400 {
    Invoke-Api POST "/amc/contracts/$($contractC.id)/renew" $adminToken @{ startDate = "2027-01-01T00:00:00.000Z"; endDate = "2027-12-31T00:00:00.000Z"; totalAmount = 1200.0 }
}
Expect-StatusCode "Sending a renewal reminder for a CANCELLED contract is rejected" 400 {
    Invoke-Api POST "/amc/contracts/$($contractC.id)/send-renewal-reminder" $adminToken $null
}

# =====================================================================================
# PART F - Expiring contracts query + manual send-renewal-reminder trigger.
# =====================================================================================

$startExpiring = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
$endExpiring = (Get-Date).AddDays(10).ToString("yyyy-MM-ddTHH:mm:ssZ")
$contractExpiring = Step "Create contract D, ACTIVE, endDate 10 days out (MONTHLY so at least 1 visit generates)" {
    Invoke-Api POST "/amc/contracts" $adminToken @{
        customerName = "Phase 10 Expiring-Soon Customer"; customerPhone = "+9715088${suffix}3"
        customerType = "B2C"; serviceCentreId = $serviceCentreId
        coveredSerialNumbers = @("SN-PH10-D1")
        coverageType = "COMPREHENSIVE"; visitFrequency = "MONTHLY"
        startDate = $startExpiring; endDate = $endExpiring
        totalAmount = 600.0; paymentTerms = "FULL_UPFRONT"
    }
}

$expiring30 = Step "GET /amc/contracts/expiring?withinDays=30" { Invoke-Api GET "/amc/contracts/expiring?withinDays=30" $adminToken $null }
$dInList = $contractExpiring.id -in $expiring30.id
Write-Host "contract D present in the 30-day expiring list: $dInList (expect True)"

$reminder = Step "POST /amc/contracts/:id/send-renewal-reminder for contract D" { Invoke-Api POST "/amc/contracts/$($contractExpiring.id)/send-renewal-reminder" $adminToken $null }
Write-Host "attempted=$($reminder.attempted -join ',') delivered=$($reminder.delivered -join ',')"

$contractExpiringAfter = Step "GET contract D again - renewalReminderSentAt should now be set" { Invoke-Api GET "/amc/contracts/$($contractExpiring.id)" $adminToken $null }
Write-Host "renewalReminderSentAt set: $([bool]$contractExpiringAfter.renewalReminderSentAt) (expect True)"

# =====================================================================================
# PART G - Upsell candidates: an OOW customer with an APPROVED estimate and no ACTIVE AMC
# contract appears; once an ACTIVE AMC contract exists on that same phone number, they no
# longer do.
# =====================================================================================

$upsellPhone = "+9715077${suffix}9"
$upsellResult = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN990001-$suffix" "upsell" $true "B2C" $upsellPhone 300

$candidatesBefore = Step "GET /amc/upsell-candidates - should include our fresh OOW customer" { Invoke-Api GET "/amc/upsell-candidates" $adminToken $null }
$ourCandidate = $candidatesBefore | Where-Object { $_.jobCardId -eq $upsellResult.jobCardId }
Write-Host "our job card present: $([bool]$ourCandidate) customerPhone=$($ourCandidate.customerPhone) estimateAmount=$($ourCandidate.estimateAmount) (expect True, $upsellPhone, 315 = 300 + 5% VAT)"

$upsellContract = Step "Create an ACTIVE AMC contract on that same phone number" {
    Invoke-Api POST "/amc/contracts" $adminToken @{
        customerName = "Phase 10 Upsell-Converted Customer"; customerPhone = $upsellPhone
        customerType = "B2C"; serviceCentreId = $serviceCentreId
        coveredSerialNumbers = @("SN990001-$suffix")
        coverageType = "COMPREHENSIVE"; visitFrequency = "HALF_YEARLY"
        startDate = "2026-09-01T00:00:00.000Z"; endDate = "2027-03-01T00:00:00.000Z"
        totalAmount = 900.0; paymentTerms = "FULL_UPFRONT"
    }
}

$candidatesAfter = Step "GET /amc/upsell-candidates again - our customer should now be excluded (covered by an ACTIVE contract)" { Invoke-Api GET "/amc/upsell-candidates" $adminToken $null }
$stillThere = $candidatesAfter | Where-Object { $_.jobCardId -eq $upsellResult.jobCardId }
Write-Host "our job card still present after AMC coverage exists: $([bool]$stillThere) (expect False)"

Write-Host "`n=================================================="
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================="
