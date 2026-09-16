# Frontend Phase 9 (Finance extension + Customer Portal) - live verification
#
# This can't be run from the cloud session (it has no network path to your machine), so
# run it yourself and paste the output back. It exercises the exact endpoints
# InvoicesPage.tsx / AgingReportPage.tsx / CustomerPortalPage.tsx send - the new
# GET /invoicing list endpoint (status + customerType filters), the existing B2B aging
# report with a fresh unpaid B2B invoice, and all three public customer-portal endpoints
# (track / invoice / summary) across every state the frontend's discriminated
# PortalInvoiceView union handles: in-warranty (not applicable), out-of-warranty with no
# invoice created yet, PARTIALLY_PAID, and PAID - plus the 404 "unknown or expired token"
# path all three share. Nothing here is invented.
#
# No spare parts/GRN needed this time - same as Phase 7/8's scripts, every job card here
# completes workshop work with zero spares requested, so this only needs a service centre,
# one warranty-master range, and one fault/symptom.
#
# PREREQUISITE: a technician test account, same as verify-phase3..8.ps1. If you already
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

# Identical to Phase 8's helper (verify-phase8.ps1) - builds one job card from a fresh
# appointment through to QC_PASSED, no spares requested, handling the OOW
# Estimate+customer-approval lifecycle in between. Factored out here since this script
# needs it many times.
function New-QcPassedJobCard($serviceCentreId, $faultCode, $symptomCode, $serialNumber, $label, $isOow, $customerType, $customerPhone, $lineItemAmount) {
    $appt = Step "[$label] Create appointment ($customerType, $(if ($isOow) {'OOW'} else {'IW'}) serial)" {
        Invoke-Api POST "/appointments" $adminToken @{
            type = "WARRANTY"; customerType = $customerType
            customerName = "Phase 9 Test Customer ($label)"; customerPhone = $customerPhone; customerEmail = "phase9-$label@example.com"
            brand = "Samsung"; modelNumber = "WA80J5710"; serialNumber = $serialNumber
            problemDescription = "Phase 9 test issue ($label)"
            invoiceNumber = "INV-PH9-$label"
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
            Invoke-Api POST "/job-cards/$jobCardId/approve-customer" $adminToken @{ notes = "Phase 9 verify - customer authorized diagnosis/repair to proceed" }
        } | Out-Null
        $estimate = Step "[$label] Create Estimate (POST /estimates)" {
            Invoke-Api POST "/estimates" $adminToken @{
                jobCardId = $jobCardId
                lineItems = @(@{ description = "Phase 9 repair ($label)"; quantity = 1; unitPrice = $lineItemAmount })
            }
        }
        Step "[$label] Send Estimate" { Invoke-Api POST "/estimates/$($estimate.id)/send" $adminToken $null } | Out-Null
        Step "[$label] Staff-record customer approval" {
            Invoke-Api POST "/estimates/$($estimate.id)/record-response" $adminToken @{
                approved = $true; contactMethod = "PHONE_CALL"; contactValue = $customerPhone
                notes = "Phase 9 verify - customer approved by phone"
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

Write-Host "Frontend Phase 9 live-verification against $BaseUrl" -ForegroundColor Yellow
$suffix = (Get-Date).ToString("HHmmss")

# 1. Admin login + idempotent self-grant of QC_APPROVAL (needed so New-QcPassedJobCard's
# own qc/approve step succeeds - a 409 on rerun is expected, not a real failure, same as
# every prior phase's script).
$adminLogin = Step "Admin login (POST /auth/login)" { Invoke-Api POST "/auth/login" $null @{ email = "admin@jackys.com"; password = "Admin123!" } }
$adminToken = $adminLogin.accessToken
if (-not $adminToken) { Write-Host "`nCan't continue without an admin token - stopping." -ForegroundColor Red; exit 1 }
$adminProfile = Step "Admin profile (GET /auth/profile)" { Invoke-Api GET "/auth/profile" $adminToken $null }
$adminUserId = $adminProfile.id

Write-Host "`n--- Grant admin the QC_APPROVAL permission (POST /permissions/grant) ---" -ForegroundColor Cyan
try {
    Invoke-Api POST "/permissions/grant" $adminToken @{ userId = $adminUserId; permissionType = "QC_APPROVAL"; notes = "Phase 9 verify script" } | Out-Null
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

# 2. Master data - same shape as Phase 8's script (5% VAT centre, one warranty-master
# range covering only the IW serial this script uses).
$centre = Step "Create service centre (POST /master-data/service-centres)" {
    Invoke-Api POST "/master-data/service-centres" $adminToken @{
        code = "PH9-$suffix"; name = "Phase 9 Verify Centre"; country = "UAE"; vatRate = 5
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

Step "Create warranty master entry covering only the IW serial this script uses (POST /master-data/warranty-master)" {
    Invoke-Api POST "/master-data/warranty-master" $adminToken @{
        serialNumberRange = "SN770000-SN779999"; brand = "Samsung"; model = "WA80J5710"
        warrantyPeriodMonths = 24; supplier = "Samsung Gulf"
    }
} | Out-Null

$faultCode = "F-PH9-$suffix"
$symptomCode = "S-PH9-$suffix"
Step "Create fault/symptom (POST /master-data/fault-symptoms)" {
    Invoke-Api POST "/master-data/fault-symptoms" $adminToken @{
        faultCode = $faultCode; faultDescription = "Phase 9 test fault"
        symptomCode = $symptomCode; symptomDescription = "Phase 9 test symptom"
        category = "WASHING_MACHINE"
    }
} | Out-Null

# 3. Build every job card this script needs, all the way to QC_PASSED.
$jcIw        = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN770001-$suffix" "iw"         $false "B2C" "+971508880001" 0
$jcOowFresh  = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN660001-$suffix" "oow-fresh"  $true  "B2C" "+971508880002" 280
$jcOowPartial= New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN660002-$suffix" "oow-partial" $true  "B2C" "+971508880003" 400
$jcOowPaid   = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN660003-$suffix" "oow-paid"   $true  "B2C" "+971508880004" 210
$jcOowB2b    = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN660004-$suffix" "oow-b2b"    $true  "B2B" "+971508880005" 600
$jcDelivered = New-QcPassedJobCard $serviceCentreId $faultCode $symptomCode "SN660005-$suffix" "delivered"  $true  "B2C" "+971508880006" 150

# 4. Fetch each Job Card's publicToken (minted at creation, GET /job-cards/:id returns the
# full entity - no select filtering excludes it) - this is exactly what JobCardsPage.tsx's
# "Customer tracking link" copy box uses.
$jcIwFull        = Step "GET /job-cards/:id for the IW job (fetch publicToken)" { Invoke-Api GET "/job-cards/$jcIw" $adminToken $null }
$jcOowFreshFull  = Step "GET /job-cards/:id for the fresh OOW job (fetch publicToken)" { Invoke-Api GET "/job-cards/$jcOowFresh" $adminToken $null }
$jcOowPartialFull= Step "GET /job-cards/:id for the partial-payment OOW job (fetch publicToken)" { Invoke-Api GET "/job-cards/$jcOowPartial" $adminToken $null }
$jcOowPaidFull   = Step "GET /job-cards/:id for the fully-paid OOW job (fetch publicToken)" { Invoke-Api GET "/job-cards/$jcOowPaid" $adminToken $null }
$jcDeliveredFull = Step "GET /job-cards/:id for the to-be-delivered OOW job (fetch publicToken)" { Invoke-Api GET "/job-cards/$jcDelivered" $adminToken $null }
Write-Host "publicToken lengths: iw=$($jcIwFull.publicToken.Length) fresh=$($jcOowFreshFull.publicToken.Length) (expect 64, 64)"

# =====================================================================================
# PART A - GET /invoicing (Frontend Phase 9's new list endpoint) + GET /invoicing/b2b-aging
# =====================================================================================

# Pay off jcOowPartial halfway, jcOowPaid in full, leave jcOowFresh untouched (no invoice
# at all yet) and jcOowB2b unpaid (DRAFT) so the list/aging filters below have a real
# spread of statuses and customer types to prove against.
$invoicePartial = Step "GET /invoicing/job-card/:jobCardId (lazy-create) for the partial-payment job" { Invoke-Api GET "/invoicing/job-card/$jcOowPartial" $adminToken $null }
Write-Host "amount=$($invoicePartial.amount) (expect 420 = 400 + 20 VAT)"
$halfAmount = [math]::Round($invoicePartial.amount / 2, 2)
Step "record-payment: CASH, half the amount" { Invoke-Api POST "/invoicing/$($invoicePartial.id)/record-payment" $adminToken @{ method = "CASH"; amountReceived = $halfAmount } } | Out-Null

$invoicePaid = Step "GET /invoicing/job-card/:jobCardId (lazy-create) for the fully-paid job" { Invoke-Api GET "/invoicing/job-card/$jcOowPaid" $adminToken $null }
Step "record-payment: CASH, full amount" { Invoke-Api POST "/invoicing/$($invoicePaid.id)/record-payment" $adminToken @{ method = "CASH"; amountReceived = [double]$invoicePaid.amount } } | Out-Null

$invoiceB2b = Step "GET /invoicing/job-card/:jobCardId (lazy-create, left unpaid) for the B2B job" { Invoke-Api GET "/invoicing/job-card/$jcOowB2b" $adminToken $null }
Write-Host "amount=$($invoiceB2b.amount) status=$($invoiceB2b.status) (expect 630 = 600 + 30 VAT, DRAFT)"

# jcOowFresh is deliberately left alone here - Part C below proves the customer portal's
# invoice view never triggers a lazy-create just by being looked at, so its own "no invoice
# yet" check has to run BEFORE this part creates one. Do that first, then come back and
# lazy-create it here so the list-filter assertions below have a DRAFT/B2C example too.

Write-Host "`n(jumping ahead: verifying the portal never lazy-creates jcOowFresh's invoice, before this script creates one itself)" -ForegroundColor DarkGray
$portalInvoiceFreshBefore = Step "GET /customer-portal/public/invoice/:token before any staff lookup - proves no side effect" {
    Invoke-Api GET "/customer-portal/public/invoice/$($jcOowFreshFull.publicToken)" $null $null
}
Write-Host "applicable=$($portalInvoiceFreshBefore.applicable) invoiceCreated=$($portalInvoiceFreshBefore.invoiceCreated) (expect True, False - no invoice minted just by viewing)"

$invoiceFresh = Step "GET /invoicing/job-card/:jobCardId (lazy-create, left unpaid) for the fresh job, now that the portal check above is done" { Invoke-Api GET "/invoicing/job-card/$jcOowFresh" $adminToken $null }
Write-Host "amount=$($invoiceFresh.amount) status=$($invoiceFresh.status) (expect 294 = 280 + 14 VAT, DRAFT)"

$invoiceDelivered = Step "GET /invoicing/job-card/:jobCardId (lazy-create) for the to-be-delivered job" { Invoke-Api GET "/invoicing/job-card/$jcDelivered" $adminToken $null }
Step "record-payment: CASH, full amount" { Invoke-Api POST "/invoicing/$($invoiceDelivered.id)/record-payment" $adminToken @{ method = "CASH"; amountReceived = [double]$invoiceDelivered.amount } } | Out-Null

# Now the list/filter assertions - a real system-of-record view across every status this
# script created: DRAFT (fresh, b2b), PARTIALLY_PAID (partial), PAID (paid, delivered).
$allInvoices = Step "GET /invoicing (no filter) - a real system-of-record view, not just B2B-unpaid-only" { Invoke-Api GET "/invoicing" $adminToken $null }
$ourInvoiceIds = @($invoicePartial.id, $invoicePaid.id, $invoiceB2b.id, $invoiceFresh.id, $invoiceDelivered.id)
$foundAll = -not ($ourInvoiceIds | Where-Object { $_ -notin $allInvoices.id })
Write-Host "total returned=$($allInvoices.Count) all 5 of ours present=$foundAll (expect True)"

$paidOnly = Step "GET /invoicing?status=PAID" { Invoke-Api GET "/invoicing?status=PAID" $adminToken $null }
$paidHasOurs = ($invoicePaid.id -in $paidOnly.id) -and ($invoiceDelivered.id -in $paidOnly.id)
$paidExcludesUnpaid = ($invoicePartial.id -notin $paidOnly.id) -and ($invoiceFresh.id -notin $paidOnly.id) -and ($invoiceB2b.id -notin $paidOnly.id)
$allActuallyPaid = -not ($paidOnly | Where-Object { $_.status -ne "PAID" })
Write-Host "status=PAID filter: includes our 2 paid=$paidHasOurs excludes our unpaid ones=$paidExcludesUnpaid every row actually PAID=$allActuallyPaid (expect True, True, True)"

$b2bOnly = Step "GET /invoicing?customerType=B2B" { Invoke-Api GET "/invoicing?customerType=B2B" $adminToken $null }
$b2bHasOurs = $invoiceB2b.id -in $b2bOnly.id
$b2bExcludesB2c = ($invoicePartial.id -notin $b2bOnly.id) -and ($invoicePaid.id -notin $b2bOnly.id) -and ($invoiceFresh.id -notin $b2bOnly.id)
Write-Host "customerType=B2B filter: includes our B2B invoice=$b2bHasOurs excludes our B2C ones=$b2bExcludesB2c (expect True, True)"

$draftB2cOnly = Step "GET /invoicing?status=DRAFT&customerType=B2C (combined filter)" { Invoke-Api GET "/invoicing?status=DRAFT&customerType=B2C" $adminToken $null }
$combinedCorrect = ($invoiceFresh.id -in $draftB2cOnly.id) -and ($invoiceB2b.id -notin $draftB2cOnly.id) -and ($invoicePaid.id -notin $draftB2cOnly.id)
Write-Host "status=DRAFT&customerType=B2C: has the fresh B2C draft, excludes the B2B draft and any PAID one=$combinedCorrect (expect True)"

$paymentsForPartial = Step "GET /invoicing/:id/payments for the partial-payment invoice" { Invoke-Api GET "/invoicing/$($invoicePartial.id)/payments" $adminToken $null }
Write-Host "payment count=$($paymentsForPartial.Count) amount=$($paymentsForPartial[0].amount) (expect 1; $halfAmount)"

$aging = Step "GET /invoicing/b2b-aging - the B2B unpaid invoice should land in the 0-30 days bucket" { Invoke-Api GET "/invoicing/b2b-aging" $adminToken $null }
$bucket030 = $aging.buckets | Where-Object { $_.label -eq "0-30 days" }
$b2bInAging = $bucket030.invoices | Where-Object { $_.id -eq $invoiceB2b.id }
Write-Host "0-30 bucket contains our B2B invoice: $([bool]$b2bInAging) bucket total includes it: $($bucket030.totalOutstanding -ge $invoiceB2b.amount) totalOutstanding overall=$($aging.totalOutstanding) (expect True, True, >0)"
$bucketCount = $aging.buckets.Count
Write-Host "bucket count=$bucketCount (expect 4 - all returned even if some are empty)"

# =====================================================================================
# PART B - Customer Portal: track (all 3 endpoints share ONE token per Job Card)
# =====================================================================================

$trackIw = Step "GET /customer-portal/public/track/:token for the IW job (no auth header sent)" { Invoke-Api GET "/customer-portal/public/track/$($jcIwFull.publicToken)" $null $null }
Write-Host "jobCardNumber=$($trackIw.jobCardNumber) status=$($trackIw.status) warrantyStatus=$($trackIw.warrantyStatus) delivery=$($trackIw.delivery) (expect QC_PASSED, IW, null)"

Expect-StatusCode "GET /customer-portal/public/track/:token with a garbage/unknown token is rejected (expect 404)" 404 {
    Invoke-Api GET "/customer-portal/public/track/this-token-does-not-exist-$suffix" $null $null
}
Expect-StatusCode "GET /customer-portal/public/invoice/:token with the same garbage token is also 404 (can't distinguish wrong from expired)" 404 {
    Invoke-Api GET "/customer-portal/public/invoice/this-token-does-not-exist-$suffix" $null $null
}
Expect-StatusCode "GET /customer-portal/public/job-card/:token/summary with the same garbage token is also 404" 404 {
    Invoke-Api GET "/customer-portal/public/job-card/this-token-does-not-exist-$suffix/summary" $null $null
}

# =====================================================================================
# PART C - Customer Portal: invoice view's 3 states (the frontend's discriminated union)
# =====================================================================================

$portalInvoiceIw = Step "GET /customer-portal/public/invoice/:token for the IW job - not applicable, warranty covers it" {
    Invoke-Api GET "/customer-portal/public/invoice/$($jcIwFull.publicToken)" $null $null
}
Write-Host "applicable=$($portalInvoiceIw.applicable) (expect False)"

# (jcOowFresh's "no invoice yet" no-side-effect check already ran above, in Part A, before
# this script lazily created its invoice - see the note there.)

$portalInvoicePartial = Step "GET /customer-portal/public/invoice/:token reflects the half-payment correctly" {
    Invoke-Api GET "/customer-portal/public/invoice/$($jcOowPartialFull.publicToken)" $null $null
}
Write-Host "status=$($portalInvoicePartial.status) amountPaid=$($portalInvoicePartial.amountPaid) amountDue=$($portalInvoicePartial.amountDue) (expect PARTIALLY_PAID; $halfAmount; $([math]::Round($invoicePartial.amount - $halfAmount, 2)))"

$portalInvoicePaid = Step "GET /customer-portal/public/invoice/:token shows fully-paid, zero due" {
    Invoke-Api GET "/customer-portal/public/invoice/$($jcOowPaidFull.publicToken)" $null $null
}
Write-Host "status=$($portalInvoicePaid.status) amountDue=$($portalInvoicePaid.amountDue) (expect PAID, 0)"

# =====================================================================================
# PART D - Customer Portal: consolidated summary (job card + estimate + invoice +
# delivery), after actually running the to-be-delivered job all the way through Delivery.
# =====================================================================================

$deliveryForSummary = Step "POST /delivery for the now-fully-paid to-be-delivered job" { Invoke-Api POST "/delivery" $adminToken @{ jobCardIds = @($jcDelivered) } }
$deliveryForSummaryId = $deliveryForSummary.delivery.id
Step "POST /delivery/:id/dispatch" { Invoke-Api POST "/delivery/$deliveryForSummaryId/dispatch" $adminToken $null } | Out-Null
Step "POST /delivery/:id/pod - marks DELIVERED" { Invoke-Api POST "/delivery/$deliveryForSummaryId/pod" $adminToken @{ recipientName = "Portal Summary Test"; signatureBase64 = "data:image/png;base64,CCCC" } } | Out-Null

$summary = Step "GET /customer-portal/public/job-card/:token/summary - consolidated view" {
    Invoke-Api GET "/customer-portal/public/job-card/$($jcDeliveredFull.publicToken)/summary" $null $null
}
Write-Host "jobCardNumber=$($summary.jobCardNumber) status=$($summary.status) (expect DELIVERED)"
Write-Host "estimate present=$([bool]$summary.estimate) estimate.totalAmount=$($summary.estimate.totalAmount) (expect True, 157.5 = 150 + 7.5 VAT)"
Write-Host "invoice.status=$($summary.invoice.status) invoice.amountDue=$($summary.invoice.amountDue) (expect PAID, 0)"
Write-Host "delivery.deliveryNumber=$($summary.delivery.deliveryNumber) delivery.status=$($summary.delivery.status) (expect DELIVERED)"

# The track endpoint should now also reflect DELIVERED, with a populated delivery block
# (this is the field the customer-portal.service.ts's trackByToken view includes that the
# summary view's own delivery field intentionally omits - dispatchedAt).
$trackDelivered = Step "GET /customer-portal/public/track/:token now shows DELIVERED with delivery timing" {
    Invoke-Api GET "/customer-portal/public/track/$($jcDeliveredFull.publicToken)" $null $null
}
Write-Host "status=$($trackDelivered.status) delivery.status=$($trackDelivered.delivery.status) dispatchedAt set=$([bool]$trackDelivered.delivery.dispatchedAt) deliveredAt set=$([bool]$trackDelivered.delivery.deliveredAt) (expect DELIVERED, DELIVERED, True, True)"

Write-Host "`n=================================================="
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================="
