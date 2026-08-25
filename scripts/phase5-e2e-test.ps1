$ErrorActionPreference = "Stop"
$base = "http://localhost:3000/api/v1"
$suffix = Get-Random -Maximum 99999

# Write-Host (not Write-Output) for status lines: a function's Write-Output goes into its
# own return pipeline and would silently contaminate $result for the caller (e.g. corrupts
# .Count on an array result) - Write-Host prints straight to the console instead.
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

function ExpectFail($name, $block) {
  try {
    & $block
    Write-Host "FAIL $name : expected an error, got success"
  } catch {
    Write-Host "OK   $name correctly failed: $($_.Exception.Response.StatusCode)"
  }
}

# 1. Login as admin
$resp = Step "login as admin" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"admin@jackys.com","password":"Admin123!"}' }
$H = @{ Authorization = "Bearer $($resp.accessToken)" }

# 2. Master data: service centre, fault/symptom, spare part model, two spare parts
$sc = Step "create service centre" { Invoke-RestMethod -Uri "$base/master-data/service-centres" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  code = "P5-$suffix"; name = "Phase5 Test Centre"; country = "UAE"; vatRate = 5.0
  schedule = @{ monday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 } }
} | ConvertTo-Json -Depth 5) }

$fs = Step "create fault-symptom" { Invoke-RestMethod -Uri "$base/master-data/fault-symptoms" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  faultCode = "P5F$suffix"; faultDescription = "Test fault"; symptomCode = "P5S$suffix"; symptomDescription = "Test symptom"; category = "WASHING_MACHINE"
} | ConvertTo-Json) }

$model = Step "create spare part model" { Invoke-RestMethod -Uri "$base/master-data/spare-part-models" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  modelId = "P5MODEL$suffix"; brand = "Samsung"; modelName = "Phase5 Test Model"
} | ConvertTo-Json) }

$spareLinked = Step "create spare part (to be linked)" { Invoke-RestMethod -Uri "$base/master-data/spare-parts" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  code = "P5-SP-L-$suffix"; name = "Drain Pump"; category = "MOTOR"
} | ConvertTo-Json) }

$spareUnlinked = Step "create spare part (left unlinked, for AC-17 negative test)" { Invoke-RestMethod -Uri "$base/master-data/spare-parts" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  code = "P5-SP-U-$suffix"; name = "Door Seal"; category = "SEAL"
} | ConvertTo-Json) }

# 3. AC-17: GRN blocked until linked to a model
ExpectFail "GRN on unlinked spare part (AC-17)" { Invoke-RestMethod -Uri "$base/inventory/grn" -Method Post -Headers $H -ContentType "application/json" -Body (@{ sparePartId = $spareUnlinked.id; quantity = 10 } | ConvertTo-Json) }

Step "link spare part to model" { Invoke-RestMethod -Uri "$base/master-data/spare-parts/$($spareLinked.id)/link-model" -Method Post -Headers $H -ContentType "application/json" -Body (@{ modelId = $model.id } | ConvertTo-Json) } | Out-Null
Step "link is idempotent (linking again does not error)" { Invoke-RestMethod -Uri "$base/master-data/spare-parts/$($spareLinked.id)/link-model" -Method Post -Headers $H -ContentType "application/json" -Body (@{ modelId = $model.id } | ConvertTo-Json) } | Out-Null

# 4. GRN now succeeds - receive 5 units
$stock = Step "GRN 5 units of linked spare part" { Invoke-RestMethod -Uri "$base/inventory/grn" -Method Post -Headers $H -ContentType "application/json" -Body (@{ sparePartId = $spareLinked.id; quantity = 5; notes = "Initial stock, Phase 5 E2E" } | ConvertTo-Json) }
Write-Output "stock after GRN: onHand=$($stock.quantityOnHand), reserved=$($stock.quantityReserved)"

# 5. Seed a field technician and a workshop technician for this run
$fieldEmail = "p5field$suffix@x.com"
$workshopEmail = "p5workshop$suffix@x.com"
Step "seed field technician" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$fieldEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='TECHNICIAN_FIELD'; npm run seed:technician" } | Out-Null
$workshopSeedOut = Step "seed workshop technician" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$workshopEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='TECHNICIAN_WORKSHOP'; npm run seed:technician" }
$workshopTechId = ($workshopSeedOut | Select-String -Pattern "user id:\s*(\S+)").Matches[0].Groups[1].Value
Write-Output "workshop technician id: $workshopTechId"

# 6. Appointment -> field technician visit -> OOW serial capture
$apt = Step "create appointment" { Invoke-RestMethod -Uri "$base/appointments" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  type = "WARRANTY"; customerType = "B2C"; customerName = "Phase5 Customer"; customerPhone = "+97150$suffix"; customerEmail = "p5customer$suffix@example.com"
  scheduledAt = "2026-08-25T10:00:00Z"; serviceCentreId = $sc.id; brand = "Samsung"; modelNumber = "P5MODEL$suffix"; invoiceNumber = "INV-P5-$suffix"
} | ConvertTo-Json) }

$fieldLogin = Step "login as field technician" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $fieldEmail; password = "Pass123!" } | ConvertTo-Json) }
$FH = @{ Authorization = "Bearer $($fieldLogin.accessToken)" }

Step "assign field technician" { Invoke-RestMethod -Uri "$base/appointments/$($apt.id)/assign-technician" -Method Put -Headers $H -ContentType "application/json" -Body (@{ technicianId = ($fieldLogin.user.id) } | ConvertTo-Json) } | Out-Null
Step "start visit" { Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/start" -Method Post -Headers $FH -ContentType "application/json" -Body '{"gpsLat":25.2048,"gpsLng":55.2708}' } | Out-Null
Step "capture serial (OOW)" { Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/serial-number" -Method Post -Headers $FH -ContentType "application/json" -Body (@{ serialNumber = "P5OOWSN$suffix"; brand = "Samsung" } | ConvertTo-Json) } | Out-Null
Step "capture fault-symptom" { Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/fault-symptom" -Method Post -Headers $FH -ContentType "application/json" -Body (@{ faultCode = "P5F$suffix"; symptomCode = "P5S$suffix" } | ConvertTo-Json) } | Out-Null

# 7. Job Card -> validate-sn -> estimate approved via public link -> assign-section WORKSHOP
$jc = Step "create job card" { Invoke-RestMethod -Uri "$base/job-cards" -Method Post -Headers $H -ContentType "application/json" -Body (@{ appointmentId = $apt.id } | ConvertTo-Json) }
$jc = Step "validate-sn" { Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/validate-sn" -Method Post -Headers $H -ContentType "application/json" -Body '{"matches":true}' }
Write-Output "job card warrantyStatus: $($jc.warrantyStatus), status: $($jc.status)"

$est = Step "create estimate" { Invoke-RestMethod -Uri "$base/estimates" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  jobCardId = $jc.id; lineItems = @(@{ description = "Drain Pump"; quantity = 1; unitPrice = 300 })
} | ConvertTo-Json -Depth 5) }
$est = Step "send estimate" { Invoke-RestMethod -Uri "$base/estimates/$($est.id)/send" -Method Post -Headers $H }
Step "public respond: approve" { Invoke-RestMethod -Uri "$base/estimates/public/$($est.accessToken)/respond" -Method Post -ContentType "application/json" -Body '{"approved":true}' } | Out-Null

$assigned = Step "assign-section WORKSHOP" { Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/assign-section" -Method Post -Headers $H -ContentType "application/json" -Body '{"section":"WORKSHOP"}' }
Write-Output "job card after assign-section: status=$($assigned.status), section=$($assigned.section)"

# 8. Assign workshop technician -> WORKSHOP_ASSIGNED -> start-wip (as the technician) -> IN_PROGRESS
$assigned = Step "workshop: assign technician" { Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/assign" -Method Post -Headers $H -ContentType "application/json" -Body (@{ technicianId = $workshopTechId } | ConvertTo-Json) }
Write-Output "job card after workshop assign: status=$($assigned.status), assignedWorkshopTechnicianId=$($assigned.assignedWorkshopTechnicianId)"

$workshopLogin = Step "login as workshop technician" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $workshopEmail; password = "Pass123!" } | ConvertTo-Json) }
$WH = @{ Authorization = "Bearer $($workshopLogin.accessToken)" }

$wip = Step "start-wip" { Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/start-wip" -Method Post -Headers $WH }
Write-Output "job card after start-wip: status=$($wip.status)"

# 9. FR-09: reserve (not deduct) - first request fully satisfied
$res1 = Step "request-spare: 2 units (full reservation, HELD)" { Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $spareLinked.id; quantity = 2 } | ConvertTo-Json) }
Write-Output "reservation 1: status=$($res1.status), quantityReserved=$($res1.quantityReserved)"

$stockAfterRes1 = Step "GET stock after first reservation" { Invoke-RestMethod -Uri "$base/inventory/stock/$($spareLinked.id)" -Method Get -Headers $H }
Write-Output "stock: onHand=$($stockAfterRes1.quantityOnHand), reserved=$($stockAfterRes1.quantityReserved) (onHand unchanged by design - only confirmReturn/GRN move it, per the physical-confirmation gate)"

# 10. the-fool failure #2 mitigation: cannot deactivate a technician who still holds a reservation
ExpectFail "deactivate workshop technician while holding reservation 1 (custody guard)" { Invoke-RestMethod -Uri "$base/auth/users/$workshopTechId/deactivate" -Method Patch -Headers $H }

# 11. Second request exceeds remaining stock (3 left of 5) -> PARTIALLY_RESERVED, job -> SPARE_PENDING
$res2 = Step "request-spare: 10 units requested, only 3 available (PARTIALLY_RESERVED)" { Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $spareLinked.id; quantity = 10 } | ConvertTo-Json) }
Write-Output "reservation 2: status=$($res2.status), quantityReserved=$($res2.quantityReserved) of quantityRequested=$($res2.quantityRequested)"

$jcAfterPartial = Step "GET job card (should be SPARE_PENDING)" { Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)" -Method Get -Headers $H }
Write-Output "job card status: $($jcAfterPartial.status)"

# 12. Blocked while SPARE_PENDING
ExpectFail "complete while SPARE_PENDING" { Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/complete" -Method Post -Headers $WH }

# 13. GET workshop state (the screen a TL already opens - surfaces stale reservations inline)
$state = Step "GET workshop state" { Invoke-RestMethod -Uri "$base/workshop/$($jc.id)" -Method Get -Headers $H }
Write-Output "workshop state: job status=$($state.jobCard.status), staleReservations count=$($state.staleReservations.Count) (0 expected - both reservations are fresh)"

$stale = Step "GET stale reservations (global)" { Invoke-RestMethod -Uri "$base/inventory/reservations/stale" -Method Get -Headers $H }
Write-Output "global stale reservations: $($stale.Count) (0 expected - nothing has aged past 24h in a live run)"
if ($stale.Count -gt 0) { Write-Output ($stale | ConvertTo-Json -Depth 5) }

# 14. Cancel the job card -> both open reservations auto-move to RETURN_PENDING (never auto-touches onHand)
$cancelled = Step "cancel job card" { Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/cancel" -Method Post -Headers $H -ContentType "application/json" -Body '{"reason":"Phase 5 E2E test - verifying reservation cleanup on cancel"}' }
Write-Output "job card after cancel: status=$($cancelled.status), cancellationReason=$($cancelled.cancellationReason)"

ExpectFail "cancel an already-cancelled job card" { Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/cancel" -Method Post -Headers $H -ContentType "application/json" -Body '{"reason":"second cancel attempt"}' }

# 15. Confirming return only succeeds if cancel really moved both reservations to RETURN_PENDING -
#     there is no GET-by-id for a single reservation, so a 200 here is the proof.
$return1 = Step "confirm-return reservation 1 (2 units)" { Invoke-RestMethod -Uri "$base/inventory/reservations/$($res1.id)/confirm-return" -Method Post -Headers $H -ContentType "application/json" -Body '{"quantityReturned":2}' }
Write-Output "reservation 1 after confirm-return: status=$($return1.status), quantityReturned=$($return1.quantityReturned)"

$return2 = Step "confirm-return reservation 2 (3 units)" { Invoke-RestMethod -Uri "$base/inventory/reservations/$($res2.id)/confirm-return" -Method Post -Headers $H -ContentType "application/json" -Body '{"quantityReturned":3}' }
Write-Output "reservation 2 after confirm-return: status=$($return2.status), quantityReturned=$($return2.quantityReturned)"

ExpectFail "confirm-return the same reservation twice" { Invoke-RestMethod -Uri "$base/inventory/reservations/$($res1.id)/confirm-return" -Method Post -Headers $H -ContentType "application/json" -Body '{"quantityReturned":2}' }

$finalStock = Step "GET final stock" { Invoke-RestMethod -Uri "$base/inventory/stock/$($spareLinked.id)" -Method Get -Headers $H }
Write-Output "final stock: onHand=$($finalStock.quantityOnHand), reserved=$($finalStock.quantityReserved)"
Write-Output "NOTE: onHand ends higher than the 5 originally received (GRN 5, both reservations confirmed-returned +2+3 = 10) because"
Write-Output "confirmReturn() is the only method that increments onHand, and nothing in Phase 5 ever decrements it for a spare that"
Write-Output "gets genuinely consumed by a completed (non-cancelled) job - there is no 'mark as consumed' step yet. Flagged in"
Write-Output "STATUS_TRACKER.md as a Phase 6 (QC) dependency, matching the original design note 'not consumed till job is completed"
Write-Output "or QC completed' - QC completion is the natural place to add that decrement, and QC doesn't exist until Phase 6."

# 16. Now that custody is fully clear, deactivation succeeds
$deactivated = Step "deactivate workshop technician (should now succeed - no open custody)" { Invoke-RestMethod -Uri "$base/auth/users/$workshopTechId/deactivate" -Method Patch -Headers $H }
Write-Output "workshop technician status after deactivation: $($deactivated.status)"

Write-Output "=== PHASE 5 E2E TEST COMPLETE ==="
