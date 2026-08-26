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
# 1. Setup: admin, service centre, fault-symptom, a REPAIR service-price-list row
#    (needed for DebitNotesService.resolveLaborCost - see that method's doc comment),
#    field + workshop technicians.
# ============================================================================
$resp = Step "login as admin" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"admin@jackys.com","password":"Admin123!"}' }
$H = @{ Authorization = "Bearer $($resp.accessToken)" }
$adminId = $resp.user.id

$sc = Step "create service centre" { Invoke-RestMethod -Uri "$base/master-data/service-centres" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  code = "P8-$suffix"; name = "Phase8 Test Centre"; country = "UAE"; vatRate = 5.0
  schedule = @{ monday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 } }
} | ConvertTo-Json -Depth 5) }

$fs = Step "create fault-symptom" { Invoke-RestMethod -Uri "$base/master-data/fault-symptoms" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  faultCode = "P8F$suffix"; faultDescription = "Test fault"; symptomCode = "P8S$suffix"; symptomDescription = "Test symptom"; category = "WASHING_MACHINE"
} | ConvertTo-Json) }

$modelId = "P8MODEL$suffix"
Step "seed REPAIR service price list row (interdepartment labor rate)" { Invoke-RestMethod -Uri "$base/master-data/price-lists" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  activityType = "REPAIR"; modelId = $modelId; priceB2B = 200; priceB2C = 250; warrantyLaborCost = 40; interdepartmentLaborCost = 80; currency = "AED"; isActive = $true
} | ConvertTo-Json) } | Out-Null

$fieldEmail = "p8field$suffix@x.com"
$workshopEmail = "p8workshop$suffix@x.com"
Step "seed field technician" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$fieldEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='TECHNICIAN_FIELD'; npm run seed:technician" } | Out-Null
$workshopSeedOut = Step "seed workshop technician" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$workshopEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='TECHNICIAN_WORKSHOP'; npm run seed:technician" }
$workshopTechId = ($workshopSeedOut | Select-String -Pattern "user id:\s*(\S+)").Matches[0].Groups[1].Value

$fieldLogin = Step "login as field technician" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $fieldEmail; password = "Pass123!" } | ConvertTo-Json) }
$fieldTechId = $fieldLogin.user.id
$workshopLogin = Step "login as workshop technician" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $workshopEmail; password = "Pass123!" } | ConvertTo-Json) }
$WH = @{ Authorization = "Bearer $($workshopLogin.accessToken)" }

Write-Output "field tech: $fieldTechId | workshop tech: $workshopTechId"

# Same slot-scheduling helper as Phase 7's script (rolls across days, never overflows).
$script:jobSlotOffset = 0
function NextSlot() {
  $script:jobSlotOffset += 1
  $dayOffset = [Math]::Floor($script:jobSlotOffset / 10)
  $hourInDay = 8 + ($script:jobSlotOffset % 10)
  $dateStr = (Get-Date "2026-09-15").AddDays($dayOffset).ToString("yyyy-MM-dd")
  return "$($dateStr)T$("{0:D2}" -f $hourInDay):00:00Z"
}

# Same NewQcPassedJob helper as Phase 7's script - appointment -> field visit -> job card
# -> validate-sn -> [IW override | OOW estimate approval] -> assign-section -> workshop
# assign+start-wip -> complete -> qc/approve.
function NewQcPassedJob($faultLabel, $warranty, $customerType, $lineItemPrice) {
  $phoneSuffix = Get-Random -Maximum 99999
  $scheduledAtStr = NextSlot
  $custPhone = "+97150$phoneSuffix"

  $apt = Invoke-RestMethod -Uri "$base/appointments" -Method Post -Headers $H -ContentType "application/json" -Body (@{
    type = "WARRANTY"; customerType = $customerType; customerName = "Phase8 Customer $faultLabel"; customerPhone = $custPhone; customerEmail = "p8customer$suffix$faultLabel@example.com"
    scheduledAt = $scheduledAtStr; serviceCentreId = $sc.id; brand = "Samsung"; modelNumber = $modelId; invoiceNumber = "INV-P8-$suffix-$faultLabel"
  } | ConvertTo-Json)

  Invoke-RestMethod -Uri "$base/appointments/$($apt.id)/assign-technician" -Method Put -Headers $H -ContentType "application/json" -Body (@{ technicianId = $fieldTechId } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/start" -Method Post -Headers $H -ContentType "application/json" -Body '{"gpsLat":25.2048,"gpsLng":55.2708}' | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/serial-number" -Method Post -Headers $H -ContentType "application/json" -Body (@{ serialNumber = "P8SN$suffix$faultLabel"; brand = "Samsung" } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/fault-symptom" -Method Post -Headers $H -ContentType "application/json" -Body (@{ faultCode = "P8F$suffix"; symptomCode = "P8S$suffix" } | ConvertTo-Json) | Out-Null

  $jc = Invoke-RestMethod -Uri "$base/job-cards" -Method Post -Headers $H -ContentType "application/json" -Body (@{ appointmentId = $apt.id } | ConvertTo-Json)
  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/validate-sn" -Method Post -Headers $H -ContentType "application/json" -Body '{"matches":true}'

  if ($warranty -eq "IW") {
    Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/warranty-override" -Method Post -Headers $H -ContentType "application/json" -Body (@{ newStatus = "IW"; reason = "Phase 8 E2E - forcing in-warranty for the interdepartment Debit Note path" } | ConvertTo-Json) | Out-Null
  } else {
    $est = Invoke-RestMethod -Uri "$base/estimates" -Method Post -Headers $H -ContentType "application/json" -Body (@{
      jobCardId = $jc.id; lineItems = @(@{ description = "Phase 8 E2E repair - $faultLabel"; quantity = 1; unitPrice = $lineItemPrice })
    } | ConvertTo-Json -Depth 5)
    Invoke-RestMethod -Uri "$base/estimates/$($est.id)/send" -Method Post -Headers $H | Out-Null
    Invoke-RestMethod -Uri "$base/estimates/$($est.id)/record-response" -Method Post -Headers $H -ContentType "application/json" -Body (@{
      approved = $true; contactMethod = "PHONE_CALL"; contactValue = $custPhone; notes = "Phase 8 E2E - phone approval, proceeding with repair"
    } | ConvertTo-Json) | Out-Null
    Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/approve-customer" -Method Post -Headers $H -ContentType "application/json" -Body '{"notes":"Phase 8 E2E - FR-06 stopgap flag"}' | Out-Null
  }

  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/assign-section" -Method Post -Headers $H -ContentType "application/json" -Body '{"section":"WORKSHOP"}'
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/assign" -Method Post -Headers $H -ContentType "application/json" -Body (@{ technicianId = $workshopTechId } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/start-wip" -Method Post -Headers $WH | Out-Null
  $jc = Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/complete" -Method Post -Headers $WH
  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/qc/approve" -Method Post -Headers $H
  return $jc
}

# ============================================================================
# 2. B2C OOW job -> lazy-draft invoice -> partial payment -> full payment -> GL check
# ============================================================================
$jcB2C = Step "create QC_PASSED OOW B2C job" { NewQcPassedJob "B2C" "OOW" "B2C" 500 }

$invB2C = Step "lazily create the invoice for the B2C job" { Invoke-RestMethod -Uri "$base/invoicing/job-card/$($jcB2C.id)" -Method Get -Headers $H }
if ($invB2C.status -ne "DRAFT") { Write-Host "FAIL invoice starts DRAFT : got $($invB2C.status)" } else { Write-Host "OK   invoice starts DRAFT ($($invB2C.amount) incl. $($invB2C.vatAmount) VAT)" }

ExpectFail "B2B_CREDIT is rejected for a B2C invoice" 403 { Invoke-RestMethod -Uri "$base/invoicing/$($invB2C.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "B2B_CREDIT"; amountReceived = 1 } | ConvertTo-Json) }

$partial = Step "record a partial Cash payment" { Invoke-RestMethod -Uri "$base/invoicing/$($invB2C.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "CASH"; amountReceived = 200; reference = "partial-1" } | ConvertTo-Json) }
if ($partial.status -ne "PARTIALLY_PAID") { Write-Host "FAIL partial payment leaves PARTIALLY_PAID : got $($partial.status)" } else { Write-Host "OK   partial payment leaves PARTIALLY_PAID" }

ExpectFail "overpayment beyond the remaining balance is rejected" 400 { Invoke-RestMethod -Uri "$base/invoicing/$($invB2C.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "CASH"; amountReceived = 9999 } | ConvertTo-Json) }

$final = Step "record the remaining balance, completing payment" { Invoke-RestMethod -Uri "$base/invoicing/$($invB2C.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "CASH"; amountReceived = 325 } | ConvertTo-Json) }
if ($final.status -ne "PAID") { Write-Host "FAIL invoice reaches PAID after full balance recorded : got $($final.status)" } else { Write-Host "OK   invoice reaches PAID after full balance recorded" }

ExpectFail "recording payment against an already-PAID invoice is rejected" 400 { Invoke-RestMethod -Uri "$base/invoicing/$($invB2C.id)/record-payment" -Method Post -Headers $H -ContentType "application/json" -Body (@{ method = "CASH"; amountReceived = 1 } | ConvertTo-Json) }

$payments = Step "list payment history for the invoice" { Invoke-RestMethod -Uri "$base/invoicing/$($invB2C.id)/payments" -Method Get -Headers $H }
if ($payments.Count -ne 2) { Write-Host "FAIL payment history has 2 entries : got $($payments.Count)" } else { Write-Host "OK   payment history has 2 entries" }

# ============================================================================
# 3. B2B OOW job left unpaid -> should surface in the B2B aging report
# ============================================================================
$jcB2B = Step "create QC_PASSED OOW B2B job (left unpaid, for aging)" { NewQcPassedJob "B2B" "OOW" "B2B" 1000 }
$invB2B = Step "lazily create the invoice for the B2B job" { Invoke-RestMethod -Uri "$base/invoicing/job-card/$($jcB2B.id)" -Method Get -Headers $H }

$aging = Step "fetch the B2B aging report" { Invoke-RestMethod -Uri "$base/invoicing/b2b-aging" -Method Get -Headers $H }
$bucket030 = $aging.buckets | Where-Object { $_.label -eq "0-30 days" }
$foundInAging = $bucket030.invoices | Where-Object { $_.id -eq $invB2B.id }
if (-not $foundInAging) { Write-Host "FAIL unpaid B2B invoice appears in the 0-30 days aging bucket : not found" } else { Write-Host "OK   unpaid B2B invoice appears in the 0-30 days aging bucket" }

# ============================================================================
# 4. Interdepartment (B2B_SALES_CHANNEL + IN_WARRANTY) job -> Debit Note -> post
# ============================================================================
$jcInterdept = Step "create QC_PASSED interdepartment (B2B_SALES_CHANNEL, IN_WARRANTY) job" { NewQcPassedJob "Interdept" "IW" "B2B_SALES_CHANNEL" 0 }

ExpectFail "an invoice cannot be generated for an in-warranty job" 400 { Invoke-RestMethod -Uri "$base/invoicing/job-card/$($jcInterdept.id)" -Method Get -Headers $H }

$dn = Step "lazily create the Debit Note for the interdepartment job" { Invoke-RestMethod -Uri "$base/debit-notes/job-card/$($jcInterdept.id)" -Method Get -Headers $H }
if ($dn.status -ne "DRAFT") { Write-Host "FAIL debit note starts DRAFT : got $($dn.status)" } else { Write-Host "OK   debit note starts DRAFT (labor $($dn.laborCost), spares $($dn.sparePartsCost), total $($dn.totalAmount))" }
if ([double]$dn.laborCost -ne 80) { Write-Host "FAIL debit note labor cost matches the seeded REPAIR price list row (80) : got $($dn.laborCost)" } else { Write-Host "OK   debit note labor cost matches the seeded REPAIR price list row (80)" }

$posted = Step "post the Debit Note" { Invoke-RestMethod -Uri "$base/debit-notes/$($dn.id)/post" -Method Post -Headers $H }
if ($posted.status -ne "POSTED") { Write-Host "FAIL debit note reaches POSTED : got $($posted.status)" } else { Write-Host "OK   debit note reaches POSTED" }

ExpectFail "posting an already-POSTED Debit Note is rejected" 400 { Invoke-RestMethod -Uri "$base/debit-notes/$($dn.id)/post" -Method Post -Headers $H }

$recharge = Step "fetch the interdepartment recharge report" { Invoke-RestMethod -Uri "$base/debit-notes/recharge-report" -Method Get -Headers $H }
if ($recharge.posted.count -lt 1) { Write-Host "FAIL recharge report counts at least 1 posted debit note : got $($recharge.posted.count)" } else { Write-Host "OK   recharge report counts at least 1 posted debit note" }

# ============================================================================
# 5. GL postings - system-generated only, one per payment + one for the debit note
# ============================================================================
$glAll = Step "list all GL postings" { Invoke-RestMethod -Uri "$base/gl-postings" -Method Get -Headers $H }
$glForThisRun = $glAll | Where-Object { $_.sourceId -eq $invB2C.id -or $_.sourceId -eq $dn.id }
if ($glForThisRun.Count -ne 3) { Write-Host "FAIL exactly 3 GL postings for this run's invoice payments + debit note : got $($glForThisRun.Count)" } else { Write-Host "OK   exactly 3 GL postings for this run's invoice payments + debit note" }

# ============================================================================
# 6. Customer Portal - public, token-gated (no auth header at all below this point)
# ============================================================================
$track = Step "customer portal: track by public token" { Invoke-RestMethod -Uri "$base/customer-portal/public/track/$($jcB2C.publicToken)" -Method Get }
if ($track.status -ne "QC_PASSED") { Write-Host "FAIL tracked status is QC_PASSED : got $($track.status)" } else { Write-Host "OK   tracked status is QC_PASSED" }

$portalInvoice = Step "customer portal: view invoice/amount-due by public token" { Invoke-RestMethod -Uri "$base/customer-portal/public/invoice/$($jcB2C.publicToken)" -Method Get }
if ($portalInvoice.amountDue -ne 0) { Write-Host "FAIL fully-paid invoice shows amountDue 0 via the portal : got $($portalInvoice.amountDue)" } else { Write-Host "OK   fully-paid invoice shows amountDue 0 via the portal" }

$portalSummary = Step "customer portal: download/summary by public token" { Invoke-RestMethod -Uri "$base/customer-portal/public/job-card/$($jcB2C.publicToken)/summary" -Method Get }
if ($portalSummary.jobCardNumber -ne $jcB2C.jobCardNumber) { Write-Host "FAIL summary jobCardNumber matches : got $($portalSummary.jobCardNumber)" } else { Write-Host "OK   summary jobCardNumber matches" }

ExpectFail "an unknown public token 404s" 404 { Invoke-RestMethod -Uri "$base/customer-portal/public/track/not-a-real-token" -Method Get }

Write-Host ""
Write-Host "=== Phase 8 E2E run complete ==="
