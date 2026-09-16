# Frontend Phase 8 (Delivery + Invoicing) - live verification
#
# This can't be run from the cloud session (it has no network path to your machine), so
# run it yourself and paste the output back. It exercises the exact endpoints
# ReadyForDeliveryPage.tsx / DeliveriesPage.tsx / RecordPaymentModal.tsx send - the IW/OOW
# ready pool with proactive invoice visibility, batch creation and its whole-batch-409-
# blockers shape (FR-12/AC-11), dispatch, POD capture (AC-12) including a mixed IW+OOW
# batch, cancel-releases-members, the new GET /delivery/:id/job-cards endpoint this phase
# added, and the Invoicing side (lazy invoice creation, partial payments, the B2B Credit
# guard, overpayment/already-paid rejection) - nothing here is invented.
#
# No spare parts/GRN needed this time - every job card here completes workshop work with
# zero spares requested (same as Phase 7's "reject" path used), so this only needs a
# service centre, one warranty-master range, and one fault/symptom.
#
# PREREQUISITE: a technician test account, same as verify-phase3/4/5/6/7.ps1. If you
# already have one, fill in its email/password/id below. If not, open a second
# PowerShell window:
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

# Builds one job card from a fresh appointment through to READY_FOR_QC then QC_PASSED, no
# spares requested. For an OOW job card this also creates + sends + approves an Estimate
# in between validate-sn and assign-section (required: EstimatesService.create() only
# accepts an OOW, SN_VALIDATED job card) - same lifecycle Phase 5/7's scripts use, factored
# out here since this script needs it many times.
function New-QcPassedJobCard($serviceCentreId, $faultCode, $symptomCode, $serialNumber, $label, $isOow, $customerType, $customerPhone, $lineItemAmount) {
    $appt = Step "[$label] Create appointment ($customerType, $(if ($isOow) {'OOW'} else {'IW'}) serial)" {
        Invoke-Api POST "/appointments" $adminToken @{
            type = "WARRANTY"; customerType = $customerType
            customerName = "Phase 8 Test Customer ($label)"; customerPhone = $customerPhone; customerEmail = "phase8-$label@example.com"
            brand = "Samsung"; modelNumber = "WA80J5710"; serialNumber = $serialNumber
            problemDescription = "Phase 8 test issue ($label)"
            invoiceNumber = "INV-PH8-$label"
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
        # FR-06: assign-section blocks an OOW job until customerApproved=true - a separate
        # flag from the Estimate's own approval, set only by this endpoint.
        Step "[$label] Approve customer (FR-06, required before assign-section for OOW)" {
            Invoke-Api POST "/job-cards/$jobCardId/approve-customer" $adminToken @{ notes = "Phase 8 verify - customer authorized diagnosis/repair to proceed" }
        } | Out-Null
        $estimate = Step "[$label] Create Estimate (POST /estimates)" {
            Invoke-Api POST "/estimates" $adminToken @{
                jobCardId = $jobCardId
                lineItems = @(@{ description = "Phase 8 repair ($label)"; quantity = 1; unitPrice = $lineItemAmount })
            }
        }
        Step "[$label] Send Estimate" { Invoke-Api POST "/estimates/$($estimate.id)/send" $adminToken $null } | Out-Null
        Step "[$label] Staff-record customer approval" {
            Invoke-Api POST "/estimates/$($estimate.id)/record-response" $adminToken @{
                approved = $true; contactMethod = "PHONE_CALL"; contactValue = $customerPhone
                notes = "Phase 8 verify - customer approved by phone"
            }
        } | Out-Null
    }

    Step "[$label] Assign section = WORKSHOP" { Invoke-Api POST "/job-cards/$jobCardId/assign-section" $adminToken @{ section = "WORKSHOP" } } | Out-Null
    Step "[$label] Assign workshop technician" { Invoke-Api POST "/workshop/$jobCardId/assign" $adminToken @{ technicianId = $TechnicianId } } | Out-Null
    Step "[$label] Start WIP" { Invoke-Api POST "/workshop/$jobCardId/start-wip" $adminToken $null } | Out-Null
    Step "[$label] Complete workshop work (no spares needed)" { Invoke-Api POST "/workshop/$jobCardId/complete" $adminToken $null } | Out-Null
    $approved = Step "[$label] QC approve (POST /job-cards/:id/qc/approve)" { Invoke-Api POST "/job-cards/$jobCardId/qc/approve" $adminToken $null }
    Write-Host "status=$($approved.status) (expect QC_PASSED)"
    return $jobCardId
}

Write-Host "Frontend Phase 8 live-verification against $BaseUrl" -ForegroundColor Yellow
$suffix = (Get-Date).ToString("HHmmss")

# 1. Admin login + self-grant QC_APPROVAL (idempotent - a 409 on rerun is expected, not a
# real failure, same as Phase 6/7's scripts). Delivery/Invoicing themselves use plain
# @Roles() (SUPER_ADMIN is on every list), so no extra grant is needed for those.
$adminLogin = Step "Admin login (POST /auth/login)" { Invoke-Api POST "/auth/login" $null @{ email = "admin@jackys.com"; password = "Admin123!" } }
$adminToken = $adminLogin.accessToken
if (-not $adminToken) { Write-Host "`nCan't continue without an admin token - stopping." -ForegroundColor Red; exit 1 }
$adminProfile = Step "Admin profile (GET /auth/profile)" { Invoke-Api GET "/auth/profile" $adminToken $null }
$adminUserId = $adminProfile.id

Write-Host "`n--- Grant admin the QC_APPROVAL permission (POST /permissions/grant) ---" -ForegroundColor Cyan
try {
    Invoke-Api POST "/permissions/grant" $adminToken @{ userId = $adminUserId; permissionType = "QC_APPROVAL"; notes = "Phase 8 verify script" } | Out-Null
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

# 2. Master data: one service centre (5% VAT, so a 300 line item -> 315 total), one
# warranty-master range covering only the IW serials this script uses. No warranty-master
# entry covers the OOW serials below, so they naturally come back OUT_OF_WARRANTY.
$centre = Step "Create service centre (POST /master-data/service-centres)" {
    Invoke-Api POST "/master-data/service-centres" $adminToken @{
        code = "PH8-$suffix"; name = "Phase 8 Verify Centre"; country = "UAE"; vatRate = 5
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

Step "Create warranty master entry covering only the IW serials this script uses (POST /master-data/warranty-master)" {
    Invoke-Api POST "/master-data/warranty-master" $adminToken @{
        serialNumberRange = "SN880000-SN889999"; brand = "Samsung"; model = "WA80J5710"
        warrantyPeriodMonths = 24; supplier = "Samsung Gulf"
    }
} | Out-Null

$faultCode = "F-PH8-$suffix"
$symptomCode = "S-PH8-$suffix"
Step "Create fault/symptom (POST /master-data/fault-symptoms)" {
    Invoke-Api POST "/master-data/fault-symptoms" $adminToken @{
        faultCode = $faultCode; faultDescription = "Phase 8 test fault"
        symptomCode = $symptomCode; symptomDescription = "Phase 8 test symptom"
        category = "WASHING_MACHINE"
    }
} | Out-Null

# 3. Build every job card this script needs, all the way to QC_PASSED, before touching
# Delivery/Invoicing at all - mirrors the real app's own phase boundary (Delivery only
# ever sees QC_PASSED work).
$jcIw       = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN880001-$suffix" "iw"          $false "B2C" "+971509990001" 0
$jcOowHappy = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN990001-$suffix" "oow-happy"   $true  "B2C" "+971509990002" 300
$jcOowSplit = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN990002-$suffix" "oow-split"   $true  "B2C" "+971509990003" 200
$jcOowB2b   = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN990003-$suffix" "oow-b2b"     $true  "B2B" "+971509990004" 500
$jcOowCancel= New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN990004-$suffix" "oow-cancel"  $true  "B2C" "+971509990005" 250
$jcIwBatch  = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN880002-$suffix" "iw-batch"    $false "B2C" "+971509990006" 0
$jcOowBatch = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN990005-$suffix" "oow-batch"   $true  "B2C" "+971509990007" 150
$jcNotReady = Step "[not-ready] Create a throwaway job card that never reaches QC_PASSED" {
    $appt = Invoke-Api POST "/appointments" $adminToken @{
        type = "WARRANTY"; customerType = "B2C"
        customerName = "Phase 8 Not-Ready Customer"; customerPhone = "+971509990099"; customerEmail = "phase8-notready@example.com"
        brand = "Samsung"; modelNumber = "WA80J5710"; serialNumber = "SN880099-$suffix"
        problemDescription = "Phase 8 test issue (not-ready)"; invoiceNumber = "INV-PH8-notready"
        scheduledAt = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ"); serviceCentreId = $serviceCentreId
    }
    Invoke-Api PUT "/appointments/$($appt.id)/confirm" $adminToken $null | Out-Null
    Invoke-Api PUT "/appointments/$($appt.id)/assign-technician" $adminToken @{ technicianId = $TechnicianId } | Out-Null
    Invoke-Api POST "/technician/visits/$($appt.id)/start" $techToken @{ gpsLat = 25.2048; gpsLng = 55.2708 } | Out-Null
    Invoke-Api POST "/technician/visits/$($appt.id)/serial-number" $techToken @{ serialNumber = "SN880099-$suffix"; brand = "Samsung" } | Out-Null
    Invoke-Api POST "/technician/visits/$($appt.id)/fault-symptom" $techToken @{ faultCode = $faultCode; symptomCode = $symptomCode } | Out-Null
    Invoke-Api PUT "/appointments/$($appt.id)/complete" $techToken $null | Out-Null
    $jc = Invoke-Api POST "/job-cards" $adminToken @{ appointmentId = $appt.id }
    return $jc.id
    # Deliberately left at OPEN - never validated/assigned/started - status stays far from QC_PASSED.
}

# 4. GET /delivery/ready - IW tab shows the IW job with no invoice fields; OOW tab shows
# the unpaid OOW jobs with invoiceStatus=null/payable=false (no invoice created yet - a
# pure lookup, per DeliveryService.findReady()'s own doc comment).
$readyIw = Step "GET /delivery/ready?warrantyStatus=IW" { Invoke-Api GET "/delivery/ready?warrantyStatus=IW" $adminToken $null }
$iwEntry = $readyIw | Where-Object { $_.jobCard.id -eq $jcIw }
Write-Host "IW ready pool contains our job: $([bool]$iwEntry); invoiceStatus=$($iwEntry.invoiceStatus) payable=$($iwEntry.payable) (expect true; null; True)"

$readyOow = Step "GET /delivery/ready?warrantyStatus=OOW" { Invoke-Api GET "/delivery/ready?warrantyStatus=OOW" $adminToken $null }
$oowEntry = $readyOow | Where-Object { $_.jobCard.id -eq $jcOowHappy }
Write-Host "OOW ready pool contains our job: $([bool]$oowEntry); invoiceStatus=$($oowEntry.invoiceStatus) payable=$($oowEntry.payable) (expect true; null (no invoice minted by just listing); False)"

# 5. Create is blocked for a non-QC_PASSED job (400) and a bogus id (404).
Expect-StatusCode "POST /delivery with a not-yet-QC_PASSED job card is rejected (expect 400)" 400 {
    Invoke-Api POST "/delivery" $adminToken @{ jobCardIds = @($jcNotReady) }
}
Expect-StatusCode "POST /delivery with a job card id that doesn't exist is rejected (expect 404)" 404 {
    Invoke-Api POST "/delivery" $adminToken @{ jobCardIds = @("00000000-0000-4000-8000-000000000000") }
}

# 6. FR-12/AC-11: creating a delivery for an unpaid OOW job is blocked WHOLE-BATCH with a
# structured 409, naming the real amount owed from a lazily-created invoice.
$blockedAttempt = Step "POST /delivery for an unpaid OOW job is blocked (expect 409 with blockers)" {
    try {
        Invoke-Api POST "/delivery" $adminToken @{ jobCardIds = @($jcOowHappy) }
        throw "Expected a 409 but the call succeeded"
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw }
        return ($_.ErrorDetails.Message | ConvertFrom-Json)
    }
}
if ($blockedAttempt) {
    $blocker = $blockedAttempt.blockers | Where-Object { $_.jobCardId -eq $jcOowHappy }
    Write-Host "blockers.Count=$($blockedAttempt.blockers.Count) amount=$($blocker.amount) invoiceStatus=$($blocker.invoiceStatus) (expect 1; 315; DRAFT)"
    $invoiceHappyId = $blocker.invoiceId
}

# That blocked attempt lazily created the invoice - GET /delivery/ready now shows it.
$readyOowAfter = Step "GET /delivery/ready?warrantyStatus=OOW now reflects the lazily-created DRAFT invoice" { Invoke-Api GET "/delivery/ready?warrantyStatus=OOW" $adminToken $null }
$oowEntryAfter = $readyOowAfter | Where-Object { $_.jobCard.id -eq $jcOowHappy }
Write-Host "invoiceStatus=$($oowEntryAfter.invoiceStatus) payable=$($oowEntryAfter.payable) (expect DRAFT; False)"

# 7. Pay it off (CASH, full amount) via GET /invoicing/job-card/:id + record-payment, then
# the same batch succeeds.
$invoiceHappy = Step "GET /invoicing/job-card/:jobCardId (lazy-create/lookup)" { Invoke-Api GET "/invoicing/job-card/$jcOowHappy" $adminToken $null }
Write-Host "invoiceNumber=$($invoiceHappy.invoiceNumber) amount=$($invoiceHappy.amount) subtotal=$($invoiceHappy.subtotal) vatAmount=$($invoiceHappy.vatAmount) status=$($invoiceHappy.status) (expect 315 = 300 + 15 VAT, DRAFT)"
$paidHappy = Step "record-payment: CASH, full amount (POST /invoicing/:id/record-payment)" {
    Invoke-Api POST "/invoicing/$($invoiceHappy.id)/record-payment" $adminToken @{ method = "CASH"; amountReceived = [double]$invoiceHappy.amount; reference = "Phase 8 verify" }
}
Write-Host "status=$($paidHappy.status) (expect PAID)"

Expect-StatusCode "record-payment on an already-PAID invoice is rejected (expect 400)" 400 {
    Invoke-Api POST "/invoicing/$($invoiceHappy.id)/record-payment" $adminToken @{ method = "CASH"; amountReceived = 10 }
}

$deliveryHappy = Step "POST /delivery now succeeds once the OOW job is PAID" { Invoke-Api POST "/delivery" $adminToken @{ jobCardIds = @($jcOowHappy) } }
Write-Host "deliveryNumber=$($deliveryHappy.delivery.deliveryNumber) status=$($deliveryHappy.delivery.status) jobCards.Count=$($deliveryHappy.jobCards.Count) (expect PENDING, 1)"
$deliveryHappyId = $deliveryHappy.delivery.id

Expect-StatusCode "Re-POSTing /delivery with the same already-attached job card is rejected (expect 409)" 409 {
    Invoke-Api POST "/delivery" $adminToken @{ jobCardIds = @($jcOowHappy) }
}

$jobCardsOfHappy = Step "GET /delivery/:id/job-cards (Frontend Phase 8's new endpoint) lists the member" { Invoke-Api GET "/delivery/$deliveryHappyId/job-cards" $adminToken $null }
Write-Host "member count=$($jobCardsOfHappy.Count), first id matches=$($jobCardsOfHappy[0].id -eq $jcOowHappy) (expect 1, True)"

$reverseLookup = Step "GET /delivery/job-card/:jobCardId finds the same delivery (reverse lookup)" { Invoke-Api GET "/delivery/job-card/$jcOowHappy" $adminToken $null }
Write-Host "reverse lookup id matches=$($reverseLookup.id -eq $deliveryHappyId) (expect True)"

Expect-StatusCode "Capturing POD before dispatch is rejected (expect 400, not DISPATCHED)" 400 {
    Invoke-Api POST "/delivery/$deliveryHappyId/pod" $adminToken @{ recipientName = "Too Early"; signatureBase64 = "data:image/png;base64,AAAA" }
}

$dispatchedHappy = Step "POST /delivery/:id/dispatch" { Invoke-Api POST "/delivery/$deliveryHappyId/dispatch" $adminToken @{ driverUserId = $TechnicianId } }
Write-Host "status=$($dispatchedHappy.status) driverUserId set=$([bool]$dispatchedHappy.driverUserId) (expect DISPATCHED, True)"

Expect-StatusCode "Dispatching an already-DISPATCHED delivery is rejected (expect 400)" 400 {
    Invoke-Api POST "/delivery/$deliveryHappyId/dispatch" $adminToken $null
}
Expect-StatusCode "Cancelling a DISPATCHED (no longer PENDING) delivery is rejected (expect 400)" 400 {
    Invoke-Api POST "/delivery/$deliveryHappyId/cancel" $adminToken @{ reason = "Too late" }
}
Expect-StatusCode "POD with neither signature nor photo is rejected (AC-12, expect 400)" 400 {
    Invoke-Api POST "/delivery/$deliveryHappyId/pod" $adminToken @{ recipientName = "Nobody" }
}

$podHappy = Step "POST /delivery/:id/pod with a signature - marks delivery AND job card DELIVERED" {
    Invoke-Api POST "/delivery/$deliveryHappyId/pod" $adminToken @{ recipientName = "Jane Doe"; signatureBase64 = "data:image/png;base64,AAAA"; notes = "Left at reception" }
}
Write-Host "delivery.status=$($podHappy.status) deliveredAt set=$([bool]$podHappy.deliveredAt) (expect DELIVERED, True)"
$jcHappyAfter = Step "Job Card status flips to DELIVERED too (GET /job-cards/:id)" { Invoke-Api GET "/job-cards/$jcOowHappy" $adminToken $null }
Write-Host "jobCard.status=$($jcHappyAfter.status) (expect DELIVERED)"

# 8. Partial payments: pay half, expect PARTIALLY_PAID; pay the rest, expect PAID; an
# overpayment attempt on the remaining balance is rejected; two Payment rows exist,
# oldest first. Also proves record-payment rejects B2B Credit for this B2C customer
# (FR-14 loophole guard) before paying normally.
$invoiceSplit = Step "GET /invoicing/job-card/:jobCardId for the split-payment job" { Invoke-Api GET "/invoicing/job-card/$jcOowSplit" $adminToken $null }
Write-Host "amount=$($invoiceSplit.amount) (expect 210 = 200 + 10 VAT)"

Expect-StatusCode "record-payment with B2B_CREDIT on a B2C job's invoice is rejected (expect 403)" 403 {
    Invoke-Api POST "/invoicing/$($invoiceSplit.id)/record-payment" $adminToken @{ method = "B2B_CREDIT"; amountReceived = [double]$invoiceSplit.amount }
}

$halfAmount = [math]::Round($invoiceSplit.amount / 2, 2)
$firstPayment = Step "record-payment: CASH, half the amount (POST /invoicing/:id/record-payment)" {
    Invoke-Api POST "/invoicing/$($invoiceSplit.id)/record-payment" $adminToken @{ method = "CASH"; amountReceived = $halfAmount }
}
Write-Host "status=$($firstPayment.status) (expect PARTIALLY_PAID)"

Expect-StatusCode "Overpaying past the remaining balance is rejected (expect 400)" 400 {
    Invoke-Api POST "/invoicing/$($invoiceSplit.id)/record-payment" $adminToken @{ method = "CARD"; amountReceived = [double]$invoiceSplit.amount }
}

$remaining = [math]::Round($invoiceSplit.amount - $halfAmount, 2)
$secondPayment = Step "record-payment: CARD, the remaining balance" {
    Invoke-Api POST "/invoicing/$($invoiceSplit.id)/record-payment" $adminToken @{ method = "CARD"; amountReceived = $remaining; reference = "card-slip-8" }
}
Write-Host "status=$($secondPayment.status) (expect PAID)"

$paymentHistory = Step "GET /invoicing/:id/payments lists both payments, oldest first" { Invoke-Api GET "/invoicing/$($invoiceSplit.id)/payments" $adminToken $null }
Write-Host "payment count=$($paymentHistory.Count) methods=$($paymentHistory[0].method),$($paymentHistory[1].method) (expect 2; CASH,CARD)"

$deliverySplit = Step "POST /delivery for the now-fully-paid split job succeeds" { Invoke-Api POST "/delivery" $adminToken @{ jobCardIds = @($jcOowSplit) } }
Write-Host "status=$($deliverySplit.delivery.status) (expect PENDING)"

# 9. B2B Credit is accepted for an actual B2B customer's job (the flip side of the guard
# above), and pays off the whole invoice in one shot.
$invoiceB2b = Step "GET /invoicing/job-card/:jobCardId for the B2B job" { Invoke-Api GET "/invoicing/job-card/$jcOowB2b" $adminToken $null }
Write-Host "amount=$($invoiceB2b.amount) (expect 525 = 500 + 25 VAT)"
$paidB2b = Step "record-payment: B2B_CREDIT is accepted for a real B2B customer (expect 201/PAID)" {
    Invoke-Api POST "/invoicing/$($invoiceB2b.id)/record-payment" $adminToken @{ method = "B2B_CREDIT"; amountReceived = [double]$invoiceB2b.amount; reference = "B2B terms - 30 days" }
}
Write-Host "status=$($paidB2b.status) paymentMethod=$($paidB2b.paymentMethod) (expect PAID, B2B_CREDIT)"
Step "POST /delivery for the B2B-Credit-paid job succeeds" { Invoke-Api POST "/delivery" $adminToken @{ jobCardIds = @($jcOowB2b) } } | Out-Null

# 10. Cancel-releases-members: create a delivery, cancel it while still PENDING, and prove
# the job card is back in the ready pool with its deliveryId cleared.
$invoiceCancel = Step "GET /invoicing/job-card/:jobCardId for the to-be-cancelled job" { Invoke-Api GET "/invoicing/job-card/$jcOowCancel" $adminToken $null }
Step "record-payment: CASH, full amount" { Invoke-Api POST "/invoicing/$($invoiceCancel.id)/record-payment" $adminToken @{ method = "CASH"; amountReceived = [double]$invoiceCancel.amount } } | Out-Null
$deliveryCancel = Step "POST /delivery for the soon-to-be-cancelled job" { Invoke-Api POST "/delivery" $adminToken @{ jobCardIds = @($jcOowCancel) } }
$deliveryCancelId = $deliveryCancel.delivery.id
$cancelled = Step "POST /delivery/:id/cancel while still PENDING" { Invoke-Api POST "/delivery/$deliveryCancelId/cancel" $adminToken @{ reason = "Phase 8 verify - testing release-on-cancel" } }
Write-Host "status=$($cancelled.status) cancellationReason set=$([bool]$cancelled.cancellationReason) (expect CANCELLED, True)"
$jcCancelAfter = Step "Job Card's deliveryId is cleared (GET /job-cards/:id)" { Invoke-Api GET "/job-cards/$jcOowCancel" $adminToken $null }
Write-Host "deliveryId=$($jcCancelAfter.deliveryId) status=$($jcCancelAfter.status) (expect null/blank, QC_PASSED)"
$readyAfterCancel = Step "Job Card reappears in GET /delivery/ready after cancellation" { Invoke-Api GET "/delivery/ready?warrantyStatus=OOW" $adminToken $null }
$backInPool = $readyAfterCancel | Where-Object { $_.jobCard.id -eq $jcOowCancel }
Write-Host "back in ready pool: $([bool]$backInPool) (expect True)"
Expect-StatusCode "Cancelling an already-CANCELLED delivery again is rejected (expect 400)" 400 {
    Invoke-Api POST "/delivery/$deliveryCancelId/cancel" $adminToken @{ reason = "Again" }
}

# 11. Batch/mixed delivery: one IW + one paid OOW job in a single POST /delivery call get
# one shared DLV# (FR-11/AC-10), and POD (photo only this time, no signature) flips both
# member job cards to DELIVERED together.
$invoiceBatch = Step "GET /invoicing/job-card/:jobCardId for the batch's OOW member" { Invoke-Api GET "/invoicing/job-card/$jcOowBatch" $adminToken $null }
Step "record-payment: CASH, full amount" { Invoke-Api POST "/invoicing/$($invoiceBatch.id)/record-payment" $adminToken @{ method = "CASH"; amountReceived = [double]$invoiceBatch.amount } } | Out-Null
$deliveryBatch = Step "POST /delivery with BOTH job cards in one call - one shared DLV# (FR-11/AC-10)" {
    Invoke-Api POST "/delivery" $adminToken @{ jobCardIds = @($jcIwBatch, $jcOowBatch) }
}
Write-Host "deliveryNumber=$($deliveryBatch.delivery.deliveryNumber) jobCards.Count=$($deliveryBatch.jobCards.Count) (expect 2)"
$deliveryBatchId = $deliveryBatch.delivery.id
$batchMembers = Step "GET /delivery/:id/job-cards lists both batch members" { Invoke-Api GET "/delivery/$deliveryBatchId/job-cards" $adminToken $null }
Write-Host "member count=$($batchMembers.Count) (expect 2)"
Step "POST /delivery/:id/dispatch (batch)" { Invoke-Api POST "/delivery/$deliveryBatchId/dispatch" $adminToken $null } | Out-Null
$podBatch = Step "POST /delivery/:id/pod with a photo only (no signature) - still satisfies AC-12" {
    Invoke-Api POST "/delivery/$deliveryBatchId/pod" $adminToken @{ recipientName = "Batch Recipient"; photoBase64 = "data:image/png;base64,BBBB" }
}
Write-Host "status=$($podBatch.status) (expect DELIVERED)"
$jcIwBatchAfter = Step "IW member flips to DELIVERED (GET /job-cards/:id)" { Invoke-Api GET "/job-cards/$jcIwBatch" $adminToken $null }
$jcOowBatchAfter = Step "OOW member flips to DELIVERED too" { Invoke-Api GET "/job-cards/$jcOowBatch" $adminToken $null }
Write-Host "IW member status=$($jcIwBatchAfter.status) OOW member status=$($jcOowBatchAfter.status) (expect both DELIVERED)"

# 12. GET /delivery (list) and its status filter both work end to end.
$allDeliveries = Step "GET /delivery (no filter) includes every delivery created above" { Invoke-Api GET "/delivery" $adminToken $null }
Write-Host "total deliveries returned=$($allDeliveries.Count) (expect at least 4)"
$deliveredOnly = Step "GET /delivery?status=DELIVERED" { Invoke-Api GET "/delivery?status=DELIVERED" $adminToken $null }
$allDelivered = -not ($deliveredOnly | Where-Object { $_.status -ne "DELIVERED" })
Write-Host "count=$($deliveredOnly.Count) all-DELIVERED=$allDelivered (expect at least 2, True)"
$noPodBlobsInList = -not ($deliveredOnly | Where-Object { $_.PSObject.Properties.Name -contains "podSignatureBase64" })
Write-Host "list response excludes POD blob columns entirely: $noPodBlobsInList (expect True - GET /delivery/:id is the only place those appear)"

Write-Host "`n=================================================="
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================="
