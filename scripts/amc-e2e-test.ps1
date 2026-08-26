$ErrorActionPreference = "Stop"
$base = "http://localhost:3000/api/v1"
$suffix = Get-Random -Maximum 99999

function Step($name, $block) {
  try {
    $result = & $block
    Write-Host "OK   $name"
    return $result
  } catch {
    Write-Host "FAIL $name : $($_.ErrorDetails.Message)"
    throw
  }
}

function ExpectFail($name, $expectedStatus, $block) {
  try {
    & $block
    Write-Host "FAIL $name : expected an error, got success"
  } catch {
    $actual = $_.Exception.Response.StatusCode
    if ($expectedStatus -and [int]$actual -ne $expectedStatus) {
      Write-Host "FAIL $name : expected HTTP $expectedStatus, got $actual : $($_.ErrorDetails.Message)"
    } else {
      Write-Host "OK   $name correctly failed: $actual : $($_.ErrorDetails.Message)"
    }
  }
}

# ============================================================================
# 1. Setup: admin login, a service centre for the AMC contracts to belong to
# ============================================================================
$resp = Step "login as admin" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"admin@jackys.com","password":"Admin123!"}' }
$H = @{ Authorization = "Bearer $($resp.accessToken)" }

$sc = Step "create service centre" { Invoke-RestMethod -Uri "$base/master-data/service-centres" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  code = "AMC-$suffix"; name = "AMC Test Centre"; country = "UAE"; vatRate = 5.0
  schedule = @{ monday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 } }
} | ConvertTo-Json -Depth 5) }

# ============================================================================
# 2. Create a B2C AMC contract - QUARTERLY over 6 months = 3 PM visits generated
# ============================================================================
$contractBody = @{
  customerName = "AMC Test Customer $suffix"
  customerPhone = "+97150$suffix"
  customerEmail = "amc$suffix@example.com"
  customerType = "B2C"
  serviceCentreId = $sc.id
  coveredSerialNumbers = @("AMC-SN-$suffix")
  brand = "Samsung"
  modelNumber = "AMCMODEL$suffix"
  coverageType = "COMPREHENSIVE"
  serviceLevel = "Standard"
  visitFrequency = "QUARTERLY"
  startDate = "2026-09-01T00:00:00.000Z"
  endDate = "2027-03-01T00:00:00.000Z"
  totalAmount = 1200
  paymentTerms = "FULL_UPFRONT"
} | ConvertTo-Json

$contract = Step "create AMC contract (auto-generates PM schedule)" { Invoke-RestMethod -Uri "$base/amc/contracts" -Method Post -Headers $H -ContentType "application/json" -Body $contractBody }
if ($contract.status -ne "ACTIVE") { Write-Host "FAIL contract starts ACTIVE : got $($contract.status)" } else { Write-Host "OK   contract starts ACTIVE ($($contract.contractNumber))" }

$schedule = Step "fetch the generated PM visit schedule" { Invoke-RestMethod -Uri "$base/amc/contracts/$($contract.id)/schedule" -Method Get -Headers $H }
if ($schedule.Count -ne 3) { Write-Host "FAIL schedule has 3 quarterly visits (Sep/Dec/Mar) : got $($schedule.Count)" } else { Write-Host "OK   schedule has 3 quarterly visits (Sep/Dec/Mar)" }
$allAmcType = ($schedule | Where-Object { $_.type -ne "AMC" }).Count -eq 0
if (-not $allAmcType) { Write-Host "FAIL every generated visit is type=AMC" } else { Write-Host "OK   every generated visit is type=AMC" }

ExpectFail "endDate before startDate is rejected" 400 { Invoke-RestMethod -Uri "$base/amc/contracts" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  customerName = "Bad Dates"; customerPhone = "+97150000"; customerType = "B2C"; serviceCentreId = $sc.id; coveredSerialNumbers = @("X")
  coverageType = "COMPREHENSIVE"; visitFrequency = "MONTHLY"; startDate = "2027-01-01T00:00:00.000Z"; endDate = "2026-01-01T00:00:00.000Z"
  totalAmount = 100; paymentTerms = "FULL_UPFRONT"
} | ConvertTo-Json) }

ExpectFail "a schedule exceeding the 60-visit safety cap is rejected" 400 { Invoke-RestMethod -Uri "$base/amc/contracts" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  customerName = "Too Many Visits"; customerPhone = "+97150001"; customerType = "B2C"; serviceCentreId = $sc.id; coveredSerialNumbers = @("X")
  coverageType = "COMPREHENSIVE"; visitFrequency = "MONTHLY"; startDate = "2020-01-01T00:00:00.000Z"; endDate = "2026-06-01T00:00:00.000Z"
  totalAmount = 100; paymentTerms = "FULL_UPFRONT"
} | ConvertTo-Json) }

# ============================================================================
# 3. Visit completion - checklist only, then an extra charge requiring approval
# ============================================================================
$visit1 = $schedule[0]
$completed1 = Step "complete visit 1 (checklist only, no extra charge)" { Invoke-RestMethod -Uri "$base/amc/visits/$($visit1.id)/complete" -Method Post -Headers $H -ContentType "application/json" -Body (@{ checklistNotes = "Filter cleaned, all normal" } | ConvertTo-Json) }
if ($completed1.visitNumber -ne 1) { Write-Host "FAIL visit 1 recorded as visitNumber 1 : got $($completed1.visitNumber)" } else { Write-Host "OK   visit 1 recorded as visitNumber 1" }

ExpectFail "completing the same visit twice is rejected" 400 { Invoke-RestMethod -Uri "$base/amc/visits/$($visit1.id)/complete" -Method Post -Headers $H -ContentType "application/json" -Body '{"checklistNotes":"again"}' }

$visit2 = $schedule[1]
ExpectFail "an extra charge without customer approval is rejected" 400 { Invoke-RestMethod -Uri "$base/amc/visits/$($visit2.id)/complete" -Method Post -Headers $H -ContentType "application/json" -Body (@{ extraChargeDescription = "Replacement belt"; extraChargeAmount = 150 } | ConvertTo-Json) }

$completed2 = Step "complete visit 2 with an approved extra charge" { Invoke-RestMethod -Uri "$base/amc/visits/$($visit2.id)/complete" -Method Post -Headers $H -ContentType "application/json" -Body (@{ extraChargeDescription = "Replacement belt"; extraChargeAmount = 150; extraChargeApprovedByCustomer = $true } | ConvertTo-Json) }
if (-not $completed2.extraChargeApprovedByCustomer) { Write-Host "FAIL visit 2's approved extra charge is recorded" } else { Write-Host "OK   visit 2's approved extra charge is recorded ($($completed2.extraChargeAmount))" }

$visitCompletionCheck = Step "fetch visit 1's completion record directly" { Invoke-RestMethod -Uri "$base/amc/visits/$($visit1.id)/completion" -Method Get -Headers $H }
if ($visitCompletionCheck.checklistNotes -ne "Filter cleaned, all normal") { Write-Host "FAIL visit 1 completion record round-trips its checklist notes" } else { Write-Host "OK   visit 1 completion record round-trips its checklist notes" }

# ============================================================================
# 4. Expiring-contracts list + manual renewal reminder trigger
# ============================================================================
$expiring = Step "fetch contracts expiring within 400 days" { Invoke-RestMethod -Uri "$base/amc/contracts/expiring?withinDays=400" -Method Get -Headers $H }
$foundExpiring = $expiring | Where-Object { $_.id -eq $contract.id }
if (-not $foundExpiring) { Write-Host "FAIL our contract appears in the expiring-within-400-days list : not found" } else { Write-Host "OK   our contract appears in the expiring-within-400-days list" }

$reminder = Step "manually trigger the renewal reminder" { Invoke-RestMethod -Uri "$base/amc/contracts/$($contract.id)/send-renewal-reminder" -Method Post -Headers $H }
Write-Host "OK   renewal reminder attempted channels: $($reminder.attempted -join ', ')"

# ============================================================================
# 5. Billing - generate a FULL_UPFRONT invoice, pay it, reject B2B Credit on a B2C contract
# ============================================================================
$billingInv = Step "generate the FULL_UPFRONT billing invoice" { Invoke-RestMethod -Uri "$base/amc/contracts/$($contract.id)/billing-invoices" -Method Post -Headers $H -ContentType "application/json" -Body (@{ periodLabel = "Full Term" } | ConvertTo-Json) }
if ([double]$billingInv.amount -ne 1200) { Write-Host "FAIL FULL_UPFRONT invoice charges the full contract amount : got $($billingInv.amount)" } else { Write-Host "OK   FULL_UPFRONT invoice charges the full contract amount (1200)" }

ExpectFail "B2B_CREDIT is rejected for a B2C AMC contract" 403 { Invoke-RestMethod -Uri "$base/amc/billing-invoices/$($billingInv.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "B2B_CREDIT" } | ConvertTo-Json) }

$paidInv = Step "record full payment (Bank Transfer)" { Invoke-RestMethod -Uri "$base/amc/billing-invoices/$($billingInv.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "BANK_TRANSFER"; reference = "AMC-E2E-TXN-1" } | ConvertTo-Json) }
if ($paidInv.status -ne "PAID") { Write-Host "FAIL billing invoice reaches PAID : got $($paidInv.status)" } else { Write-Host "OK   billing invoice reaches PAID" }

ExpectFail "recording payment against an already-PAID AMC billing invoice is rejected" 400 { Invoke-RestMethod -Uri "$base/amc/billing-invoices/$($billingInv.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "CASH" } | ConvertTo-Json) }

# ============================================================================
# 6. B2B contract - QUARTERLY billing split + B2B_CREDIT accepted
# ============================================================================
$b2bContractBody = @{
  customerName = "AMC B2B Customer $suffix"; customerPhone = "+97151$suffix"; customerType = "B2B"; serviceCentreId = $sc.id
  coveredSerialNumbers = @("AMC-B2B-SN-$suffix"); coverageType = "COMPREHENSIVE"; visitFrequency = "HALF_YEARLY"
  startDate = "2026-09-01T00:00:00.000Z"; endDate = "2027-09-01T00:00:00.000Z"; totalAmount = 4000; paymentTerms = "QUARTERLY"
} | ConvertTo-Json
$b2bContract = Step "create a B2B AMC contract (QUARTERLY billing terms)" { Invoke-RestMethod -Uri "$base/amc/contracts" -Method Post -Headers $H -ContentType "application/json" -Body $b2bContractBody }

$b2bInv = Step "generate a QUARTERLY installment invoice for the B2B contract" { Invoke-RestMethod -Uri "$base/amc/contracts/$($b2bContract.id)/billing-invoices" -Method Post -Headers $H -ContentType "application/json" -Body (@{ periodLabel = "Q1" } | ConvertTo-Json) }
if ([double]$b2bInv.amount -ne 1000) { Write-Host "FAIL QUARTERLY installment is 1/4 of totalAmount (4000/4=1000) : got $($b2bInv.amount)" } else { Write-Host "OK   QUARTERLY installment is 1/4 of totalAmount (4000/4=1000)" }

$b2bPaid = Step "record B2B_CREDIT payment for the B2B contract" { Invoke-RestMethod -Uri "$base/amc/billing-invoices/$($b2bInv.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "B2B_CREDIT" } | ConvertTo-Json) }
if ($b2bPaid.status -ne "PAID") { Write-Host "FAIL B2B_CREDIT payment succeeds for a B2B contract : got $($b2bPaid.status)" } else { Write-Host "OK   B2B_CREDIT payment succeeds for a B2B contract" }

# ============================================================================
# 7. Cancel a contract - future SCHEDULED visits should cascade-cancel
# ============================================================================
$cancelContractBody = @{
  customerName = "AMC Cancel Test $suffix"; customerPhone = "+97152$suffix"; customerType = "B2C"; serviceCentreId = $sc.id
  coveredSerialNumbers = @("AMC-CXL-SN-$suffix"); coverageType = "LABOR_ONLY"; visitFrequency = "QUARTERLY"
  startDate = "2026-09-01T00:00:00.000Z"; endDate = "2027-03-01T00:00:00.000Z"; totalAmount = 900; paymentTerms = "FULL_UPFRONT"
} | ConvertTo-Json
$cancelContract = Step "create a contract to cancel" { Invoke-RestMethod -Uri "$base/amc/contracts" -Method Post -Headers $H -ContentType "application/json" -Body $cancelContractBody }

$cancelled = Step "cancel the contract" { Invoke-RestMethod -Uri "$base/amc/contracts/$($cancelContract.id)/cancel" -Method Post -Headers $H -ContentType "application/json" -Body (@{ reason = "AMC E2E - testing cascade cancellation" } | ConvertTo-Json) }
if ($cancelled.status -ne "CANCELLED") { Write-Host "FAIL contract reaches CANCELLED : got $($cancelled.status)" } else { Write-Host "OK   contract reaches CANCELLED" }

$scheduleAfterCancel = Step "fetch the schedule after cancellation" { Invoke-RestMethod -Uri "$base/amc/contracts/$($cancelContract.id)/schedule" -Method Get -Headers $H }
$stillScheduled = ($scheduleAfterCancel | Where-Object { $_.status -eq "SCHEDULED" }).Count
if ($stillScheduled -ne 0) { Write-Host "FAIL every future visit is cancelled alongside the contract : $stillScheduled still SCHEDULED" } else { Write-Host "OK   every future visit is cancelled alongside the contract" }

ExpectFail "cancelling an already-CANCELLED contract is rejected" 400 { Invoke-RestMethod -Uri "$base/amc/contracts/$($cancelContract.id)/cancel" -Method Post -Headers $H -ContentType "application/json" -Body (@{ reason = "again" } | ConvertTo-Json) }

# ============================================================================
# 8. Renew a contract - forward-only chain, previousContractId set, original RENEWED
# ============================================================================
$renewContractBody = @{
  customerName = "AMC Renew Test $suffix"; customerPhone = "+97153$suffix"; customerType = "B2C"; serviceCentreId = $sc.id
  coveredSerialNumbers = @("AMC-RNW-SN-$suffix"); coverageType = "COMPREHENSIVE"; visitFrequency = "HALF_YEARLY"
  startDate = "2026-09-01T00:00:00.000Z"; endDate = "2027-03-01T00:00:00.000Z"; totalAmount = 800; paymentTerms = "FULL_UPFRONT"
} | ConvertTo-Json
$renewContract = Step "create a contract to renew" { Invoke-RestMethod -Uri "$base/amc/contracts" -Method Post -Headers $H -ContentType "application/json" -Body $renewContractBody }

$renewed = Step "renew the contract" { Invoke-RestMethod -Uri "$base/amc/contracts/$($renewContract.id)/renew" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  startDate = "2027-09-01T00:00:00.000Z"; endDate = "2028-03-01T00:00:00.000Z"; totalAmount = 900
} | ConvertTo-Json) }
if ($renewed.previousContractId -ne $renewContract.id) { Write-Host "FAIL renewed contract chains back via previousContractId : got $($renewed.previousContractId)" } else { Write-Host "OK   renewed contract chains back via previousContractId" }

$originalAfterRenew = Step "fetch the original contract after renewal" { Invoke-RestMethod -Uri "$base/amc/contracts/$($renewContract.id)" -Method Get -Headers $H }
if ($originalAfterRenew.status -ne "RENEWED") { Write-Host "FAIL original contract is marked RENEWED : got $($originalAfterRenew.status)" } else { Write-Host "OK   original contract is marked RENEWED" }

ExpectFail "renewing an already-RENEWED contract is rejected" 400 { Invoke-RestMethod -Uri "$base/amc/contracts/$($renewContract.id)/renew" -Method Post -Headers $H -ContentType "application/json" -Body (@{ startDate = "2029-01-01T00:00:00.000Z"; endDate = "2029-06-01T00:00:00.000Z"; totalAmount = 100 } | ConvertTo-Json) }

# ============================================================================
# 9. Upsell candidates - smoke test (structure only, population depends on other data)
# ============================================================================
$upsell = Step "fetch RWR upsell candidates" { Invoke-RestMethod -Uri "$base/amc/upsell-candidates" -Method Get -Headers $H }
Write-Host "OK   upsell-candidates endpoint returned $($upsell.Count) candidate(s)"

Write-Host ""
Write-Host "=== AMC Management E2E run complete ==="
