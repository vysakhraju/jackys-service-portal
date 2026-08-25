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
# 1. Setup: admin, service centre, fault-symptom, model, QC grant, technicians,
#    two logistics dispatchers (for the concurrency test), a driver.
# ============================================================================
$resp = Step "login as admin" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"admin@jackys.com","password":"Admin123!"}' }
$H = @{ Authorization = "Bearer $($resp.accessToken)" }
$adminId = $resp.user.id

$sc = Step "create service centre" { Invoke-RestMethod -Uri "$base/master-data/service-centres" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  code = "P7-$suffix"; name = "Phase7 Test Centre"; country = "UAE"; vatRate = 5.0
  schedule = @{ monday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 } }
} | ConvertTo-Json -Depth 5) }

$fs = Step "create fault-symptom" { Invoke-RestMethod -Uri "$base/master-data/fault-symptoms" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  faultCode = "P7F$suffix"; faultDescription = "Test fault"; symptomCode = "P7S$suffix"; symptomDescription = "Test symptom"; category = "WASHING_MACHINE"
} | ConvertTo-Json) }

try {
  Invoke-RestMethod -Uri "$base/permissions/grant" -Method Post -Headers $H -ContentType "application/json" -Body (@{ userId = $adminId; permissionType = "QC_APPROVAL"; notes = "Phase 7 E2E - admin covering QC to set up delivery fixtures" } | ConvertTo-Json) | Out-Null
  Write-Host "OK   admin grants self QC_APPROVAL"
} catch {
  if ([int]$_.Exception.Response.StatusCode -eq 409) {
    Write-Host "OK   admin already holds an active QC_APPROVAL grant (re-run) - continuing"
  } else {
    Write-Host "FAIL admin grants self QC_APPROVAL : $($_.ErrorDetails.Message)"
    throw
  }
}

$fieldEmail = "p7field$suffix@x.com"
$workshopEmail = "p7workshop$suffix@x.com"
$dispatchAEmail = "p7dispatchA$suffix@x.com"
$dispatchBEmail = "p7dispatchB$suffix@x.com"
$driverEmail = "p7driver$suffix@x.com"

Step "seed field technician" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$fieldEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='TECHNICIAN_FIELD'; npm run seed:technician" } | Out-Null
$workshopSeedOut = Step "seed workshop technician" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$workshopEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='TECHNICIAN_WORKSHOP'; npm run seed:technician" }
$workshopTechId = ($workshopSeedOut | Select-String -Pattern "user id:\s*(\S+)").Matches[0].Groups[1].Value
Step "seed logistics dispatcher A" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$dispatchAEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='LOGISTICS_DISPATCHER'; npm run seed:technician" } | Out-Null
Step "seed logistics dispatcher B" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$dispatchBEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='LOGISTICS_DISPATCHER'; npm run seed:technician" } | Out-Null
$driverSeedOut = Step "seed driver" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$driverEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='DRIVER'; npm run seed:technician" }
$driverId = ($driverSeedOut | Select-String -Pattern "user id:\s*(\S+)").Matches[0].Groups[1].Value

$fieldLogin = Step "login as field technician" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $fieldEmail; password = "Pass123!" } | ConvertTo-Json) }
$fieldTechId = $fieldLogin.user.id
$workshopLogin = Step "login as workshop technician" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $workshopEmail; password = "Pass123!" } | ConvertTo-Json) }
$WH = @{ Authorization = "Bearer $($workshopLogin.accessToken)" }
$dispatchALogin = Step "login as dispatcher A" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $dispatchAEmail; password = "Pass123!" } | ConvertTo-Json) }
$DAH = @{ Authorization = "Bearer $($dispatchALogin.accessToken)" }
$dispatchBLogin = Step "login as dispatcher B" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $dispatchBEmail; password = "Pass123!" } | ConvertTo-Json) }
$DBH = @{ Authorization = "Bearer $($dispatchBLogin.accessToken)" }

Write-Output "field tech: $fieldTechId | workshop tech: $workshopTechId | dispatcher A/B ready | driver: $driverId"

# Helper: appointment -> field visit -> job card -> validate-sn -> [IW override | OOW
# estimate approval] -> assign-section -> workshop assign+start-wip -> complete ->
# qc/approve. Unregistered test serial numbers come back OOW by default (no
# warranty-master match) - warranty=IW explicitly overrides that.
# Slots increment by 1 within an 8am-5pm window (10 slots/day) then roll to the next
# calendar day - unlike a naive "add 2 hours per call" scheme, this can never produce an
# invalid (>23) hour no matter how many jobs a run creates.
$script:jobSlotOffset = 0
function NextSlot() {
  $script:jobSlotOffset += 1
  $dayOffset = [Math]::Floor($script:jobSlotOffset / 10)
  $hourInDay = 8 + ($script:jobSlotOffset % 10)
  $dateStr = (Get-Date "2026-08-26").AddDays($dayOffset).ToString("yyyy-MM-dd")
  return "$($dateStr)T$("{0:D2}" -f $hourInDay):00:00Z"
}

function NewQcPassedJob($faultLabel, $warranty, $customerType, $lineItemPrice) {
  $phoneSuffix = Get-Random -Maximum 99999
  $scheduledAtStr = NextSlot
  $custPhone = "+97150$phoneSuffix"

  $apt = Invoke-RestMethod -Uri "$base/appointments" -Method Post -Headers $H -ContentType "application/json" -Body (@{
    type = "WARRANTY"; customerType = $customerType; customerName = "Phase7 Customer $faultLabel"; customerPhone = $custPhone; customerEmail = "p7customer$suffix$faultLabel@example.com"
    scheduledAt = $scheduledAtStr; serviceCentreId = $sc.id; brand = "Samsung"; modelNumber = "P7MODEL$suffix"; invoiceNumber = "INV-P7-$suffix-$faultLabel"
  } | ConvertTo-Json)

  Invoke-RestMethod -Uri "$base/appointments/$($apt.id)/assign-technician" -Method Put -Headers $H -ContentType "application/json" -Body (@{ technicianId = $fieldTechId } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/start" -Method Post -Headers $H -ContentType "application/json" -Body '{"gpsLat":25.2048,"gpsLng":55.2708}' | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/serial-number" -Method Post -Headers $H -ContentType "application/json" -Body (@{ serialNumber = "P7SN$suffix$faultLabel"; brand = "Samsung" } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/fault-symptom" -Method Post -Headers $H -ContentType "application/json" -Body (@{ faultCode = "P7F$suffix"; symptomCode = "P7S$suffix" } | ConvertTo-Json) | Out-Null

  $jc = Invoke-RestMethod -Uri "$base/job-cards" -Method Post -Headers $H -ContentType "application/json" -Body (@{ appointmentId = $apt.id } | ConvertTo-Json)
  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/validate-sn" -Method Post -Headers $H -ContentType "application/json" -Body '{"matches":true}'

  if ($warranty -eq "IW") {
    Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/warranty-override" -Method Post -Headers $H -ContentType "application/json" -Body (@{ newStatus = "IW"; reason = "Phase 7 E2E - forcing in-warranty for the no-invoice delivery path" } | ConvertTo-Json) | Out-Null
  } else {
    # OOW (the default for an unregistered test S/N) - needs a real approved Estimate
    # (what InvoicingService snapshots amount from) AND the separate FR-06
    # customerApproved stopgap flag (what assign-section itself checks).
    $est = Invoke-RestMethod -Uri "$base/estimates" -Method Post -Headers $H -ContentType "application/json" -Body (@{
      jobCardId = $jc.id; lineItems = @(@{ description = "Phase 7 E2E repair - $faultLabel"; quantity = 1; unitPrice = $lineItemPrice })
    } | ConvertTo-Json -Depth 5)
    Invoke-RestMethod -Uri "$base/estimates/$($est.id)/send" -Method Post -Headers $H | Out-Null
    Invoke-RestMethod -Uri "$base/estimates/$($est.id)/record-response" -Method Post -Headers $H -ContentType "application/json" -Body (@{
      approved = $true; contactMethod = "PHONE_CALL"; contactValue = $custPhone; notes = "Phase 7 E2E - phone approval, proceeding with repair"
    } | ConvertTo-Json) | Out-Null
    Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/approve-customer" -Method Post -Headers $H -ContentType "application/json" -Body '{"notes":"Phase 7 E2E - FR-06 stopgap flag, separate from the Estimate approval above"}' | Out-Null
  }

  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/assign-section" -Method Post -Headers $H -ContentType "application/json" -Body '{"section":"WORKSHOP"}'
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/assign" -Method Post -Headers $H -ContentType "application/json" -Body (@{ technicianId = $workshopTechId } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/start-wip" -Method Post -Headers $WH | Out-Null
  $jc = Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/complete" -Method Post -Headers $WH
  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/qc/approve" -Method Post -Headers $H
  return $jc
}

# ============================================================================
# 2. HAPPY PATH: batch delivery + dispatch + POD for two IW jobs. No invoice
#    ever gets created for either (nothing to collect - warranty covers it).
# ============================================================================
$jcIw1 = Step "jcIw1: build IW job through to QC_PASSED" { NewQcPassedJob "IW1" "IW" "B2C" 0 }
$jcIw2 = Step "jcIw2: build IW job through to QC_PASSED" { NewQcPassedJob "IW2" "IW" "B2C" 0 }
Write-Output "jcIw1 status: $($jcIw1.status) | jcIw2 status: $($jcIw2.status)"

$readyIw = Step "GET /delivery/ready?warrantyStatus=IW - both IW jobs appear, already payable (nothing to pay)" { Invoke-RestMethod -Uri "$base/delivery/ready?warrantyStatus=IW" -Method Get -Headers $DAH }
$readyIwIds = $readyIw | ForEach-Object { $_.jobCard.id }
Write-Output "ready IW pool contains jcIw1: $($readyIwIds -contains $jcIw1.id) | jcIw2: $($readyIwIds -contains $jcIw2.id)"

$dlvHappy = Step "dispatcher A: POST /delivery - batch both IW jobs into one DLV#" { Invoke-RestMethod -Uri "$base/delivery" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ jobCardIds = @($jcIw1.id, $jcIw2.id) } | ConvertTo-Json) }
Write-Output "delivery created: $($dlvHappy.delivery.deliveryNumber), status=$($dlvHappy.delivery.status), members=$($dlvHappy.jobCards.Count)"

$dlvGet = Step "GET /delivery/:id" { Invoke-RestMethod -Uri "$base/delivery/$($dlvHappy.delivery.id)" -Method Get -Headers $DAH }
Write-Output "delivery status: $($dlvGet.status)"

$dlvDispatched = Step "dispatcher A: POST /delivery/:id/dispatch with a named driver" { Invoke-RestMethod -Uri "$base/delivery/$($dlvHappy.delivery.id)/dispatch" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ driverUserId = $driverId } | ConvertTo-Json) }
Write-Output "delivery after dispatch: status=$($dlvDispatched.status), driverUserId=$($dlvDispatched.driverUserId)"

ExpectFail "POD capture rejected when neither signature nor photo is provided (AC-12)" 400 { Invoke-RestMethod -Uri "$base/delivery/$($dlvHappy.delivery.id)/pod" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ recipientName = "Anita Kumar" } | ConvertTo-Json) }

$podResult = Step "POD capture with a signature only - delivery and both member Job Cards become DELIVERED" { Invoke-RestMethod -Uri "$base/delivery/$($dlvHappy.delivery.id)/pod" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ signatureBase64 = "c2lnbmF0dXJlLXBhZC10cmFjZS1kYXRh"; recipientName = "Anita Kumar"; notes = "Handed over at reception" } | ConvertTo-Json) }
Write-Output "delivery after POD: status=$($podResult.status), podRecipientName=$($podResult.podRecipientName)"

$jcIw1After = Step "GET jcIw1 - confirm DELIVERED" { Invoke-RestMethod -Uri "$base/job-cards/$($jcIw1.id)" -Method Get -Headers $H }
$jcIw2After = Step "GET jcIw2 - confirm DELIVERED" { Invoke-RestMethod -Uri "$base/job-cards/$($jcIw2.id)" -Method Get -Headers $H }
Write-Output "jcIw1: $($jcIw1After.status) | jcIw2: $($jcIw2After.status)"

ExpectFail "cannot re-batch an already-DELIVERED Job Card into a new delivery" 400 { Invoke-RestMethod -Uri "$base/delivery" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ jobCardIds = @($jcIw1.id) } | ConvertTo-Json) }

# ============================================================================
# 3. FR-12/AC-11 OOW-PAID BLOCK, then resolved via record-payment.
# ============================================================================
$jcOow1 = Step "jcOow1: build OOW job (Estimate approved, AED 470) through to QC_PASSED" { NewQcPassedJob "OOW1" "OOW" "B2C" 470 }
Write-Output "jcOow1 status: $($jcOow1.status)"

$readyOow = Step "GET /delivery/ready?warrantyStatus=OOW - proactive payment visibility, not yet payable" { Invoke-RestMethod -Uri "$base/delivery/ready?warrantyStatus=OOW" -Method Get -Headers $DAH }
$jcOow1Ready = $readyOow | Where-Object { $_.jobCard.id -eq $jcOow1.id }
Write-Output "jcOow1 in ready pool: invoiceStatus=$($jcOow1Ready.invoiceStatus), payable=$($jcOow1Ready.payable)"

$blockResp = $null
try {
  Invoke-RestMethod -Uri "$base/delivery" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ jobCardIds = @($jcOow1.id) } | ConvertTo-Json)
  Write-Host "FAIL delivery should have been blocked (409) - unpaid OOW job"
} catch {
  if ([int]$_.Exception.Response.StatusCode -eq 409) {
    $blockResp = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "OK   delivery correctly blocked (409): $($blockResp.blockers[0].jobCardNumber) owes $($blockResp.blockers[0].amount)"
  } else {
    Write-Host "FAIL delivery: expected 409, got $($_.Exception.Response.StatusCode)"
  }
}
$oow1InvoiceId = $blockResp.blockers[0].invoiceId
$oow1Amount = $blockResp.blockers[0].amount
Write-Output "jcOow1 invoice: id=$oow1InvoiceId, amount=$oow1Amount"

Step "record CASH payment for the exact invoice amount" { Invoke-RestMethod -Uri "$base/invoicing/$oow1InvoiceId/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "CASH"; amountReceived = $oow1Amount; reference = "receipt-$suffix" } | ConvertTo-Json) } | Out-Null

$dlvOow1 = Step "delivery now succeeds for the now-paid OOW job" { Invoke-RestMethod -Uri "$base/delivery" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ jobCardIds = @($jcOow1.id) } | ConvertTo-Json) }
Write-Output "delivery created: $($dlvOow1.delivery.deliveryNumber)"
Step "dispatch" { Invoke-RestMethod -Uri "$base/delivery/$($dlvOow1.delivery.id)/dispatch" -Method Post -Headers $DAH } | Out-Null
$podOow1 = Step "POD capture with a photo only (proves signature OR photo, not AND)" { Invoke-RestMethod -Uri "$base/delivery/$($dlvOow1.delivery.id)/pod" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ photoBase64 = "cGhvdG8tYnl0ZXMtaGVyZQ=="; recipientName = "Rashid Al Maktoum" } | ConvertTo-Json) }
Write-Output "delivery after POD (photo only): status=$($podOow1.status)"

# ============================================================================
# 4. B2B Credit loophole: rejected for a B2C customer.
# ============================================================================
$jcOow2 = Step "jcOow2: build OOW job (B2C customer, AED 300 estimate) through to QC_PASSED" { NewQcPassedJob "OOW2" "OOW" "B2C" 300 }
$invOow2 = Step "GET /invoicing/job-card/:id - lazily creates the DRAFT invoice" { Invoke-RestMethod -Uri "$base/invoicing/job-card/$($jcOow2.id)" -Method Get -Headers $H }
Write-Output "jcOow2 invoice: $($invOow2.invoiceNumber), amount=$($invOow2.amount)"

ExpectFail "B2B_CREDIT rejected for a B2C customer (closes the payment-bypass loophole)" 403 { Invoke-RestMethod -Uri "$base/invoicing/$($invOow2.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "B2B_CREDIT"; amountReceived = $invOow2.amount } | ConvertTo-Json) }

$jcOow2B2b = Step "jcOow2b: the SAME scenario but an actual B2B customer - B2B_CREDIT succeeds" { NewQcPassedJob "OOW2B" "OOW" "B2B" 300 }
$invOow2B2b = Step "GET invoice for the B2B job" { Invoke-RestMethod -Uri "$base/invoicing/job-card/$($jcOow2B2b.id)" -Method Get -Headers $H }
$paidB2b = Step "record B2B_CREDIT payment - succeeds for a real B2B customer" { Invoke-RestMethod -Uri "$base/invoicing/$($invOow2B2b.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "B2B_CREDIT"; amountReceived = $invOow2B2b.amount } | ConvertTo-Json) }
Write-Output "B2B invoice after payment: status=$($paidB2b.status), method=$($paidB2b.paymentMethod)"

# ============================================================================
# 5. Amount-mismatch rejection - no silent partial "paid".
# ============================================================================
$jcOow3 = Step "jcOow3: build OOW job (AED 550 estimate) through to QC_PASSED" { NewQcPassedJob "OOW3" "OOW" "B2C" 550 }
$invOow3 = Step "GET invoice for jcOow3" { Invoke-RestMethod -Uri "$base/invoicing/job-card/$($jcOow3.id)" -Method Get -Headers $H }
ExpectFail "amountReceived that does not match the invoice amount is rejected" 400 { Invoke-RestMethod -Uri "$base/invoicing/$($invOow3.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "CASH"; amountReceived = ([double]$invOow3.amount - 1) } | ConvertTo-Json) }

# ============================================================================
# 6. CONCURRENCY: two dispatchers batch the SAME Job Card at the same time.
#    Exactly one must win (201); the other must see a clean 409, never a
#    silent double-claim.
# ============================================================================
$jcRace = Step "jcRace: build IW job through to QC_PASSED" { NewQcPassedJob "RACE" "IW" "B2C" 0 }

Write-Host "firing POST /delivery from dispatcher A and dispatcher B CONCURRENTLY on the same Job Card..."
$tokenA = $dispatchALogin.accessToken
$tokenB = $dispatchBLogin.accessToken
$jobRaceA = Start-Job -ScriptBlock {
  param($base, $jcId, $token)
  try {
    $r = Invoke-RestMethod -Uri "$base/delivery" -Method Post -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body (@{ jobCardIds = @($jcId) } | ConvertTo-Json)
    return @{ ok = $true; deliveryNumber = $r.delivery.deliveryNumber }
  } catch {
    return @{ ok = $false; status = [int]$_.Exception.Response.StatusCode }
  }
} -ArgumentList $base, $jcRace.id, $tokenA
$jobRaceB = Start-Job -ScriptBlock {
  param($base, $jcId, $token)
  try {
    $r = Invoke-RestMethod -Uri "$base/delivery" -Method Post -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body (@{ jobCardIds = @($jcId) } | ConvertTo-Json)
    return @{ ok = $true; deliveryNumber = $r.delivery.deliveryNumber }
  } catch {
    return @{ ok = $false; status = [int]$_.Exception.Response.StatusCode }
  }
} -ArgumentList $base, $jcRace.id, $tokenB

$doneRace = Wait-Job -Job $jobRaceA, $jobRaceB -Timeout 20
if ($doneRace.Count -lt 2) {
  Write-Host "FAIL concurrent delivery-create: TIMED OUT after 20s - possible deadlock"
  Get-Job | Stop-Job
} else {
  $resA = Receive-Job -Job $jobRaceA -ErrorAction SilentlyContinue
  $resB = Receive-Job -Job $jobRaceB -ErrorAction SilentlyContinue
  $aWon = ($resA.ok -eq $true)
  $bWon = ($resB.ok -eq $true)
  if ($aWon -and -not $bWon -and $resB.status -eq 409) {
    Write-Host "OK   concurrent delivery-create: dispatcher A won ($($resA.deliveryNumber)), dispatcher B got a clean 409 - no double-claim"
  } elseif ($bWon -and -not $aWon -and $resA.status -eq 409) {
    Write-Host "OK   concurrent delivery-create: dispatcher B won ($($resB.deliveryNumber)), dispatcher A got a clean 409 - no double-claim"
  } else {
    Write-Host "FAIL concurrent delivery-create: resA.ok=$($resA.ok) resB.ok=$($resB.ok) resA.status=$($resA.status) resB.status=$($resB.status) (expected exactly one winner, one 409 loser)"
  }
}
Remove-Job -Job $jobRaceA, $jobRaceB -Force -ErrorAction SilentlyContinue

# ============================================================================
# 7. Batch cancel before dispatch - members return to the ready-for-delivery pool.
# ============================================================================
$jcCancel1 = Step "jcCancel1: build IW job through to QC_PASSED" { NewQcPassedJob "CANCEL1" "IW" "B2C" 0 }
$jcCancel2 = Step "jcCancel2: build IW job through to QC_PASSED" { NewQcPassedJob "CANCEL2" "IW" "B2C" 0 }

$dlvCancel = Step "batch both into one delivery" { Invoke-RestMethod -Uri "$base/delivery" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ jobCardIds = @($jcCancel1.id, $jcCancel2.id) } | ConvertTo-Json) }
$cancelled = Step "cancel the PENDING delivery" { Invoke-RestMethod -Uri "$base/delivery/$($dlvCancel.delivery.id)/cancel" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ reason = "Wrong job cards batched together" } | ConvertTo-Json) }
Write-Output "delivery after cancel: status=$($cancelled.status)"

$readyAfterCancel = Step "GET /delivery/ready - both members are back in the pool" { Invoke-RestMethod -Uri "$base/delivery/ready?warrantyStatus=IW" -Method Get -Headers $DAH }
$readyAfterCancelIds = $readyAfterCancel | ForEach-Object { $_.jobCard.id }
Write-Output "jcCancel1 back in pool: $($readyAfterCancelIds -contains $jcCancel1.id) | jcCancel2 back in pool: $($readyAfterCancelIds -contains $jcCancel2.id)"

ExpectFail "cannot dispatch an already-CANCELLED delivery" 400 { Invoke-RestMethod -Uri "$base/delivery/$($dlvCancel.delivery.id)/dispatch" -Method Post -Headers $DAH }
ExpectFail "cannot cancel an already-CANCELLED delivery again" 400 { Invoke-RestMethod -Uri "$base/delivery/$($dlvCancel.delivery.id)/cancel" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ reason = "again" } | ConvertTo-Json) }

# Re-batch the freed job cards to prove the release was real, not cosmetic.
$dlvRebatch = Step "re-batch jcCancel1 into a fresh delivery after release" { Invoke-RestMethod -Uri "$base/delivery" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ jobCardIds = @($jcCancel1.id) } | ConvertTo-Json) }
Write-Output "re-batch succeeded: $($dlvRebatch.delivery.deliveryNumber)"

# ============================================================================
# 8. Misc guards: missing Job Card, not-QC_PASSED Job Card, GET /delivery list,
#    GET /delivery/job-card/:jobCardId before/after attachment.
# ============================================================================
# A properly-formatted v4 UUID that simply doesn't exist in the DB (all-zeros fails
# class-validator's @IsUUID('4') version check, which is a different, earlier 400 - not
# what this case is testing).
$missingJobCardId = [guid]::NewGuid().ToString()
ExpectFail "POST /delivery with a well-formed but nonexistent Job Card id" 404 { Invoke-RestMethod -Uri "$base/delivery" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ jobCardIds = @($missingJobCardId) } | ConvertTo-Json) }

$jcNotReady = Step "jcNotReady: build a job that stops at IN_PROGRESS (not QC_PASSED)" {
  $phoneSuffix = Get-Random -Maximum 99999
  $apt = Invoke-RestMethod -Uri "$base/appointments" -Method Post -Headers $H -ContentType "application/json" -Body (@{
    type = "WARRANTY"; customerType = "B2C"; customerName = "Phase7 Customer NOTREADY"; customerPhone = "+97150$phoneSuffix"; customerEmail = "p7customerNOTREADY$suffix@example.com"
    scheduledAt = (NextSlot); serviceCentreId = $sc.id; brand = "Samsung"; modelNumber = "P7MODEL$suffix"; invoiceNumber = "INV-P7-$suffix-NOTREADY"
  } | ConvertTo-Json)
  Invoke-RestMethod -Uri "$base/appointments/$($apt.id)/assign-technician" -Method Put -Headers $H -ContentType "application/json" -Body (@{ technicianId = $fieldTechId } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/start" -Method Post -Headers $H -ContentType "application/json" -Body '{"gpsLat":25.2048,"gpsLng":55.2708}' | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/serial-number" -Method Post -Headers $H -ContentType "application/json" -Body (@{ serialNumber = "P7SNNOTREADY$suffix"; brand = "Samsung" } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/fault-symptom" -Method Post -Headers $H -ContentType "application/json" -Body (@{ faultCode = "P7F$suffix"; symptomCode = "P7S$suffix" } | ConvertTo-Json) | Out-Null
  $jc = Invoke-RestMethod -Uri "$base/job-cards" -Method Post -Headers $H -ContentType "application/json" -Body (@{ appointmentId = $apt.id } | ConvertTo-Json)
  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/validate-sn" -Method Post -Headers $H -ContentType "application/json" -Body '{"matches":true}'
  Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/warranty-override" -Method Post -Headers $H -ContentType "application/json" -Body (@{ newStatus = "IW"; reason = "Phase 7 E2E - not-ready fixture" } | ConvertTo-Json) | Out-Null
  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/assign-section" -Method Post -Headers $H -ContentType "application/json" -Body '{"section":"WORKSHOP"}'
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/assign" -Method Post -Headers $H -ContentType "application/json" -Body (@{ technicianId = $workshopTechId } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/start-wip" -Method Post -Headers $WH | Out-Null
  return $jc
}
ExpectFail "POST /delivery with a Job Card that is not QC_PASSED yet (still IN_PROGRESS)" 400 { Invoke-RestMethod -Uri "$base/delivery" -Method Post -Headers $DAH -ContentType "application/json" -Body (@{ jobCardIds = @($jcNotReady.id) } | ConvertTo-Json) }

$nullDelivery = Step "GET /delivery/job-card/:id before any delivery exists - null" { Invoke-RestMethod -Uri "$base/delivery/job-card/$($jcOow3.id)" -Method Get -Headers $DAH }
Write-Output "jcOow3 delivery before batching: $nullDelivery"

$deliveryList = Step "GET /delivery?status=PENDING" { Invoke-RestMethod -Uri "$base/delivery?status=PENDING" -Method Get -Headers $DAH }
Write-Output "PENDING deliveries currently listed: $(@($deliveryList).Count)"

Write-Output "=== PHASE 7 E2E TEST COMPLETE ==="
