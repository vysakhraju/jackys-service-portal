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

# 1. Login as admin, seed master data + stock
$resp = Step "login as admin" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"admin@jackys.com","password":"Admin123!"}' }
$H = @{ Authorization = "Bearer $($resp.accessToken)" }

$sc = Step "create service centre" { Invoke-RestMethod -Uri "$base/master-data/service-centres" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  code = "P6-$suffix"; name = "Phase6 Test Centre"; country = "UAE"; vatRate = 5.0
  schedule = @{ monday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 } }
} | ConvertTo-Json -Depth 5) }

$fs = Step "create fault-symptom" { Invoke-RestMethod -Uri "$base/master-data/fault-symptoms" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  faultCode = "P6F$suffix"; faultDescription = "Test fault"; symptomCode = "P6S$suffix"; symptomDescription = "Test symptom"; category = "WASHING_MACHINE"
} | ConvertTo-Json) }

$model = Step "create spare part model" { Invoke-RestMethod -Uri "$base/master-data/spare-part-models" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  modelId = "P6MODEL$suffix"; brand = "Samsung"; modelName = "Phase6 Test Model"
} | ConvertTo-Json) }

function NewLinkedPart($code, $name) {
  $p = Invoke-RestMethod -Uri "$base/master-data/spare-parts" -Method Post -Headers $H -ContentType "application/json" -Body (@{ code = $code; name = $name; category = "MOTOR" } | ConvertTo-Json)
  Invoke-RestMethod -Uri "$base/master-data/spare-parts/$($p.id)/link-model" -Method Post -Headers $H -ContentType "application/json" -Body (@{ modelId = $model.id } | ConvertTo-Json) | Out-Null
  return $p
}

$partX = Step "create + link spare part X (plenty of stock)" { NewLinkedPart "P6-SP-X-$suffix" "Compressor Relay" }
$partShort = Step "create + link spare part Short (limited stock)" { NewLinkedPart "P6-SP-SHORT-$suffix" "Rare Control Board" }
$partA = Step "create + link spare part A (concurrency demo)" { NewLinkedPart "P6-SP-A-$suffix" "Concurrency Part A" }
$partB = Step "create + link spare part B (concurrency demo)" { NewLinkedPart "P6-SP-B-$suffix" "Concurrency Part B" }

Step "GRN partX: 20 units" { Invoke-RestMethod -Uri "$base/inventory/grn" -Method Post -Headers $H -ContentType "application/json" -Body (@{ sparePartId = $partX.id; quantity = 20 } | ConvertTo-Json) } | Out-Null
Step "GRN partShort: 2 units only" { Invoke-RestMethod -Uri "$base/inventory/grn" -Method Post -Headers $H -ContentType "application/json" -Body (@{ sparePartId = $partShort.id; quantity = 2 } | ConvertTo-Json) } | Out-Null
Step "GRN partA: 10 units" { Invoke-RestMethod -Uri "$base/inventory/grn" -Method Post -Headers $H -ContentType "application/json" -Body (@{ sparePartId = $partA.id; quantity = 10 } | ConvertTo-Json) } | Out-Null
Step "GRN partB: 10 units" { Invoke-RestMethod -Uri "$base/inventory/grn" -Method Post -Headers $H -ContentType "application/json" -Body (@{ sparePartId = $partB.id; quantity = 10 } | ConvertTo-Json) } | Out-Null

# 2. Seed users: field tech, workshop tech, a CCE granted QC_APPROVAL, and reuse the field
#    tech to be granted REWORK_APPROVAL - deliberately proving the grant is admin-assignable
#    to ANY role, not just a dedicated QC_OFFICER/Team Leader.
$fieldEmail = "p6field$suffix@x.com"
$workshopEmail = "p6workshop$suffix@x.com"
$qcEmail = "p6qc$suffix@x.com"

Step "seed field technician" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$fieldEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='TECHNICIAN_FIELD'; npm run seed:technician" } | Out-Null
$workshopSeedOut = Step "seed workshop technician" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$workshopEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='TECHNICIAN_WORKSHOP'; npm run seed:technician" }
$workshopTechId = ($workshopSeedOut | Select-String -Pattern "user id:\s*(\S+)").Matches[0].Groups[1].Value
$qcSeedOut = Step "seed QC-eligible CCE user (not yet QC-granted)" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='$qcEmail'; `$env:SEED_TECH_PASSWORD='Pass123!'; `$env:SEED_TECH_ROLE='CCE'; npm run seed:technician" }
$qcUserId = ($qcSeedOut | Select-String -Pattern "user id:\s*(\S+)").Matches[0].Groups[1].Value

$fieldLogin = Step "login as field technician" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $fieldEmail; password = "Pass123!" } | ConvertTo-Json) }
$fieldTechId = $fieldLogin.user.id
$workshopLogin = Step "login as workshop technician" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $workshopEmail; password = "Pass123!" } | ConvertTo-Json) }
$WH = @{ Authorization = "Bearer $($workshopLogin.accessToken)" }
$qcLogin = Step "login as CCE (future QC approver)" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $qcEmail; password = "Pass123!" } | ConvertTo-Json) }
$QCH = @{ Authorization = "Bearer $($qcLogin.accessToken)" }

Write-Output "field tech id: $fieldTechId | workshop tech id: $workshopTechId | CCE (future QC approver) id: $qcUserId"

# Helper: appointment -> field visit -> job card -> validate-sn -> assign-section WORKSHOP -> assign+start-wip
$script:jobSlotOffset = 0
function NewWorkshopJob($faultLabel) {
  $phoneSuffix = Get-Random -Maximum 99999
  # Each call uses the same field technician, so slots must not overlap (AppointmentsService
  # checks real technician availability) - space them 2 hours apart per call.
  $script:jobSlotOffset += 2
  $slotHour = 8 + $script:jobSlotOffset
  $scheduledAtStr = "2026-08-25T$("{0:D2}" -f $slotHour):00:00Z"
  $apt = Invoke-RestMethod -Uri "$base/appointments" -Method Post -Headers $H -ContentType "application/json" -Body (@{
    type = "WARRANTY"; customerType = "B2C"; customerName = "Phase6 Customer $faultLabel"; customerPhone = "+97150$phoneSuffix"; customerEmail = "p6customer$suffix$faultLabel@example.com"
    scheduledAt = $scheduledAtStr; serviceCentreId = $sc.id; brand = "Samsung"; modelNumber = "P6MODEL$suffix"; invoiceNumber = "INV-P6-$suffix-$faultLabel"
  } | ConvertTo-Json)

  Invoke-RestMethod -Uri "$base/appointments/$($apt.id)/assign-technician" -Method Put -Headers $H -ContentType "application/json" -Body (@{ technicianId = $fieldTechId } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/start" -Method Post -Headers $H -ContentType "application/json" -Body '{"gpsLat":25.2048,"gpsLng":55.2708}' | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/serial-number" -Method Post -Headers $H -ContentType "application/json" -Body (@{ serialNumber = "P6SN$suffix$faultLabel"; brand = "Samsung" } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/fault-symptom" -Method Post -Headers $H -ContentType "application/json" -Body (@{ faultCode = "P6F$suffix"; symptomCode = "P6S$suffix" } | ConvertTo-Json) | Out-Null

  $jc = Invoke-RestMethod -Uri "$base/job-cards" -Method Post -Headers $H -ContentType "application/json" -Body (@{ appointmentId = $apt.id } | ConvertTo-Json)
  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/validate-sn" -Method Post -Headers $H -ContentType "application/json" -Body '{"matches":true}'
  # Unregistered test serial numbers come back OOW (no warranty-master match) - use the
  # FR-06 manual-approval stopgap so assign-section isn't blocked. Not the point of this
  # script (that's Phase 4's estimate flow); just clearing the prerequisite.
  if ($jc.warrantyStatus -eq "OOW") {
    Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/approve-customer" -Method Post -Headers $H -ContentType "application/json" -Body '{"notes":"Phase 6 E2E - stopgap approval, not testing the estimate flow here"}' | Out-Null
  }
  $jc = Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/assign-section" -Method Post -Headers $H -ContentType "application/json" -Body '{"section":"WORKSHOP"}'
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/assign" -Method Post -Headers $H -ContentType "application/json" -Body (@{ technicianId = $workshopTechId } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/workshop/$($jc.id)/start-wip" -Method Post -Headers $WH | Out-Null
  return $jc
}

# ============================================================================
# 3. HAPPY PATH: reserve fully, complete, QC-gate access control, QC approve,
#    stock actually moves Main Store -> Damage Location.
# ============================================================================
$jcMain = Step "jcMain: create + start-wip" { NewWorkshopJob "MAIN" }
Step "jcMain: request 3 units of partX (fully reserved)" { Invoke-RestMethod -Uri "$base/workshop/$($jcMain.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partX.id; quantity = 3 } | ConvertTo-Json) } | Out-Null
$jcMain = Step "jcMain: complete -> READY_FOR_QC" { Invoke-RestMethod -Uri "$base/workshop/$($jcMain.id)/complete" -Method Post -Headers $WH }
Write-Output "jcMain status: $($jcMain.status)"

ExpectFail "jcMain: CCE without QC_APPROVAL grant cannot approve" 403 { Invoke-RestMethod -Uri "$base/job-cards/$($jcMain.id)/qc/approve" -Method Post -Headers $QCH }

$grant = Step "admin grants QC_APPROVAL to the CCE (admin-assignable to ANY role - not a dedicated QC_OFFICER)" { Invoke-RestMethod -Uri "$base/permissions/grant" -Method Post -Headers $H -ContentType "application/json" -Body (@{ userId = $qcUserId; permissionType = "QC_APPROVAL"; notes = "Phase 6 E2E - CCE covering QC this week" } | ConvertTo-Json) }
Write-Output "grant issued: id=$($grant.id), type=$($grant.permissionType), grantedTo=$($grant.userId)"

$mainStockBefore = Step "GET partX stock before QC approve" { Invoke-RestMethod -Uri "$base/inventory/stock/$($partX.id)" -Method Get -Headers $H }
Write-Output "partX MAIN_STORE before approve: onHand=$($mainStockBefore.quantityOnHand), reserved=$($mainStockBefore.quantityReserved)"

$approved = Step "jcMain: CCE (now QC-granted) approves - FR-10 atomic consumption" { Invoke-RestMethod -Uri "$base/job-cards/$($jcMain.id)/qc/approve" -Method Post -Headers $QCH }
Write-Output "jcMain after approve: status=$($approved.status), qcApprovedByUserId=$($approved.qcApprovedByUserId)"

$mainStockAfter = Step "GET partX MAIN_STORE stock after QC approve" { Invoke-RestMethod -Uri "$base/inventory/stock/$($partX.id)" -Method Get -Headers $H }
$damageStockAfter = Step "GET partX DAMAGE_LOCATION stock after QC approve" { Invoke-RestMethod -Uri "$base/inventory/stock/$($partX.id)?location=DAMAGE_LOCATION" -Method Get -Headers $H }
Write-Output "partX MAIN_STORE after: onHand=$($mainStockAfter.quantityOnHand) (expected $($mainStockBefore.quantityOnHand - 3)), reserved=$($mainStockAfter.quantityReserved) (expected $($mainStockBefore.quantityReserved - 3))"
Write-Output "partX DAMAGE_LOCATION after: onHand=$($damageStockAfter.quantityOnHand) (expected 3) <- FR-10 Main Store -> Damage Location, real double-entry movement"

ExpectFail "jcMain: cannot approve QC twice (already QC_PASSED)" 400 { Invoke-RestMethod -Uri "$base/job-cards/$($jcMain.id)/qc/approve" -Method Post -Headers $QCH }

# ============================================================================
# 4. NEGATIVE-INVENTORY HARD GATE: a still-short part blocks approval even
#    though the Job Card reached READY_FOR_QC (an unrelated fully-held request
#    flipped it out of SPARE_PENDING) - then resolves cleanly via GRN + top-up.
# ============================================================================
$jcShort = Step "jcShort: create + start-wip" { NewWorkshopJob "SHORT" }
$shortRes = Step "jcShort: request 5 units of partShort, only 2 on hand (PARTIALLY_RESERVED)" { Invoke-RestMethod -Uri "$base/workshop/$($jcShort.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partShort.id; quantity = 5 } | ConvertTo-Json) }
Write-Output "partShort reservation: status=$($shortRes.status), reserved=$($shortRes.quantityReserved) of requested=$($shortRes.quantityRequested)"

$jcShortState = Step "jcShort: GET (should be SPARE_PENDING)" { Invoke-RestMethod -Uri "$base/job-cards/$($jcShort.id)" -Method Get -Headers $H }
Write-Output "jcShort status: $($jcShortState.status)"

Step "jcShort: request 1 unit of an UNRELATED partX (fully held - flips job back to IN_PROGRESS even though partShort is still short)" { Invoke-RestMethod -Uri "$base/workshop/$($jcShort.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partX.id; quantity = 1 } | ConvertTo-Json) } | Out-Null
$jcShort = Step "jcShort: complete -> READY_FOR_QC (Phase 5 allows this - the job-level check only looks at the latest request)" { Invoke-RestMethod -Uri "$base/workshop/$($jcShort.id)/complete" -Method Post -Headers $WH }
Write-Output "jcShort status: $($jcShort.status) <- reached READY_FOR_QC despite partShort still being short"

ExpectFail "jcShort: QC approve blocked - partShort's most recent request is still PARTIALLY_RESERVED (the hard stock-sufficiency gate)" 409 { Invoke-RestMethod -Uri "$base/job-cards/$($jcShort.id)/qc/approve" -Method Post -Headers $QCH }

Step "resolve: GRN 10 more units of partShort" { Invoke-RestMethod -Uri "$base/inventory/grn" -Method Post -Headers $H -ContentType "application/json" -Body (@{ sparePartId = $partShort.id; quantity = 10 } | ConvertTo-Json) } | Out-Null
$topup = Step "jcShort: top up the remaining 3 units of partShort directly from READY_FOR_QC (now fully available)" { Invoke-RestMethod -Uri "$base/workshop/$($jcShort.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partShort.id; quantity = 3 } | ConvertTo-Json) }
Write-Output "top-up reservation: status=$($topup.status)"
$jcShortAfterTopup = Step "jcShort: GET (status should still be READY_FOR_QC - a top-up on an already-complete job never re-opens it)" { Invoke-RestMethod -Uri "$base/job-cards/$($jcShort.id)" -Method Get -Headers $H }
Write-Output "jcShort status after top-up: $($jcShortAfterTopup.status)"

$shortApproved = Step "jcShort: QC approve now SUCCEEDS - the latest request for partShort is HELD, the old PARTIALLY_RESERVED row doesn't block it, and BOTH rows get consumed together" { Invoke-RestMethod -Uri "$base/job-cards/$($jcShort.id)/qc/approve" -Method Post -Headers $QCH }
Write-Output "jcShort after approve: status=$($shortApproved.status)"

$partShortDamage = Step "GET partShort DAMAGE_LOCATION stock" { Invoke-RestMethod -Uri "$base/inventory/stock/$($partShort.id)?location=DAMAGE_LOCATION" -Method Get -Headers $H }
Write-Output "partShort DAMAGE_LOCATION: onHand=$($partShortDamage.quantityOnHand) (expected 5 = 2 original + 3 top-up)"

# ============================================================================
# 5. QC REJECT + REWORK GATE: reject sends the job back; consuming the SAME
#    part again on the SAME job needs sign-off (admin-grantable to ANY role -
#    here, the field technician) or a verbal override.
# ============================================================================
$jcRework = Step "jcRework: create + start-wip" { NewWorkshopJob "REWORK" }
Step "jcRework: request 2 units of partX (fully reserved)" { Invoke-RestMethod -Uri "$base/workshop/$($jcRework.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partX.id; quantity = 2 } | ConvertTo-Json) } | Out-Null
$jcRework = Step "jcRework: complete -> READY_FOR_QC" { Invoke-RestMethod -Uri "$base/workshop/$($jcRework.id)/complete" -Method Post -Headers $WH }

$rejected = Step "jcRework: QC reject - sends it back to the workshop" { Invoke-RestMethod -Uri "$base/job-cards/$($jcRework.id)/qc/reject" -Method Post -Headers $QCH -ContentType "application/json" -Body '{"reason":"Compressor relay still clicking under load - reseat and retest"}' }
Write-Output "jcRework after reject: status=$($rejected.status), qcRejectionCount=$($rejected.qcRejectionCount)"

ExpectFail "jcRework: re-requesting the SAME part with no approver/verbal-override is blocked (rework gate)" 400 { Invoke-RestMethod -Uri "$base/workshop/$($jcRework.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partX.id; quantity = 1 } | ConvertTo-Json) }

ExpectFail "jcRework: the requester cannot approve their own rework re-request (anti-self-dealing)" 400 { Invoke-RestMethod -Uri "$base/workshop/$($jcRework.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partX.id; quantity = 1; approverId = $workshopTechId } | ConvertTo-Json) }

ExpectFail "jcRework: an approver with no REWORK_APPROVAL grant is rejected" 403 { Invoke-RestMethod -Uri "$base/workshop/$($jcRework.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partX.id; quantity = 1; approverId = $qcUserId } | ConvertTo-Json) }

$reworkGrant = Step "admin grants REWORK_APPROVAL to the FIELD TECHNICIAN (proving admin can assign it to ANY role, not just a supervisor)" { Invoke-RestMethod -Uri "$base/permissions/grant" -Method Post -Headers $H -ContentType "application/json" -Body (@{ userId = $fieldTechId; permissionType = "REWORK_APPROVAL"; notes = "Phase 6 E2E - covering for the TL today" } | ConvertTo-Json) }
Write-Output "rework grant issued to field technician: $($reworkGrant.userId)"

$reworkRes = Step "jcRework: re-request with a valid rework approver succeeds" { Invoke-RestMethod -Uri "$base/workshop/$($jcRework.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partX.id; quantity = 1; approverId = $fieldTechId } | ConvertTo-Json) }
Write-Output "rework reservation: status=$($reworkRes.status), reworkApprovedByUserId=$($reworkRes.reworkApprovedByUserId)"

$jcRework = Step "jcRework: complete -> READY_FOR_QC" { Invoke-RestMethod -Uri "$base/workshop/$($jcRework.id)/complete" -Method Post -Headers $WH }
$reworkApproved = Step "jcRework: QC approve - consumes BOTH the original and the rework reservation" { Invoke-RestMethod -Uri "$base/job-cards/$($jcRework.id)/qc/approve" -Method Post -Headers $QCH }
Write-Output "jcRework after approve: status=$($reworkApproved.status)"

# 5b. Verbal-override fallback path, on a second rework job
$jcVerbal = Step "jcVerbal: create + start-wip" { NewWorkshopJob "VERBAL" }
Step "jcVerbal: request 1 unit of partX" { Invoke-RestMethod -Uri "$base/workshop/$($jcVerbal.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partX.id; quantity = 1 } | ConvertTo-Json) } | Out-Null
$jcVerbal = Step "jcVerbal: complete -> READY_FOR_QC" { Invoke-RestMethod -Uri "$base/workshop/$($jcVerbal.id)/complete" -Method Post -Headers $WH }
Step "jcVerbal: QC reject" { Invoke-RestMethod -Uri "$base/job-cards/$($jcVerbal.id)/qc/reject" -Method Post -Headers $QCH -ContentType "application/json" -Body '{"reason":"Needs a second relay - first one was DOA"}' } | Out-Null

ExpectFail "jcVerbal: verbal override with too-short notes is rejected" 400 { Invoke-RestMethod -Uri "$base/workshop/$($jcVerbal.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partX.id; quantity = 1; verbalOverrideBy = "Supervisor Raj"; verbalOverrideNotes = "ok" } | ConvertTo-Json) }

$verbalRes = Step "jcVerbal: re-request via verbal override (no REWORK_APPROVAL holder reachable)" { Invoke-RestMethod -Uri "$base/workshop/$($jcVerbal.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partX.id; quantity = 1; verbalOverrideBy = "Supervisor Raj (phone, off-site)"; verbalOverrideNotes = "No one with REWORK_APPROVAL reachable on-site; customer waiting for urgent pickup, verbally authorized by phone." } | ConvertTo-Json) }
Write-Output "verbal-override reservation: status=$($verbalRes.status), reworkVerbalOverrideBy=$($verbalRes.reworkVerbalOverrideBy)"

# ============================================================================
# 6. CONCURRENCY: two Job Cards reserve the SAME two parts in REVERSE order
#    (jcConcA: A then B / jcConcB: B then A). Firing qc/approve on both at the
#    same time must not deadlock - the per-job-card lock + sorted per-part
#    locking inside consumeReservationsOnQcApproval guarantees a consistent
#    acquisition order regardless of request order.
# ============================================================================
$jcConcA = Step "jcConcA: create + start-wip" { NewWorkshopJob "CONCA" }
$jcConcB = Step "jcConcB: create + start-wip" { NewWorkshopJob "CONCB" }

Step "jcConcA: reserve partA then partB" {
  Invoke-RestMethod -Uri "$base/workshop/$($jcConcA.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partA.id; quantity = 1 } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/workshop/$($jcConcA.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partB.id; quantity = 1 } | ConvertTo-Json) | Out-Null
} | Out-Null
Step "jcConcB: reserve partB then partA (reverse order)" {
  Invoke-RestMethod -Uri "$base/workshop/$($jcConcB.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partB.id; quantity = 1 } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/workshop/$($jcConcB.id)/request-spare" -Method Post -Headers $WH -ContentType "application/json" -Body (@{ sparePartId = $partA.id; quantity = 1 } | ConvertTo-Json) | Out-Null
} | Out-Null

$jcConcA = Step "jcConcA: complete -> READY_FOR_QC" { Invoke-RestMethod -Uri "$base/workshop/$($jcConcA.id)/complete" -Method Post -Headers $WH }
$jcConcB = Step "jcConcB: complete -> READY_FOR_QC" { Invoke-RestMethod -Uri "$base/workshop/$($jcConcB.id)/complete" -Method Post -Headers $WH }

Write-Host "firing qc/approve on jcConcA and jcConcB CONCURRENTLY..."
$qcToken = $qcLogin.accessToken
$jobA = Start-Job -ScriptBlock {
  param($base, $id, $token)
  Invoke-RestMethod -Uri "$base/job-cards/$id/qc/approve" -Method Post -Headers @{ Authorization = "Bearer $token" }
} -ArgumentList $base, $jcConcA.id, $qcToken
$jobB = Start-Job -ScriptBlock {
  param($base, $id, $token)
  Invoke-RestMethod -Uri "$base/job-cards/$id/qc/approve" -Method Post -Headers @{ Authorization = "Bearer $token" }
} -ArgumentList $base, $jcConcB.id, $qcToken

$done = Wait-Job -Job $jobA, $jobB -Timeout 20
if ($done.Count -lt 2) {
  Write-Host "FAIL concurrent qc/approve: TIMED OUT after 20s - possible deadlock"
  Get-Job | Stop-Job
} else {
  $resultA = Receive-Job -Job $jobA -ErrorAction SilentlyContinue
  $resultB = Receive-Job -Job $jobB -ErrorAction SilentlyContinue
  if ($resultA.status -eq "QC_PASSED" -and $resultB.status -eq "QC_PASSED") {
    Write-Host "OK   concurrent qc/approve: both completed within 20s, no deadlock. jcConcA=$($resultA.status) jcConcB=$($resultB.status)"
  } else {
    Write-Host "FAIL concurrent qc/approve: jcConcA=$($resultA.status) jcConcB=$($resultB.status) (expected both QC_PASSED)"
  }
}
Remove-Job -Job $jobA, $jobB -Force -ErrorAction SilentlyContinue

$partADamage = Step "GET partA DAMAGE_LOCATION stock (expect 2: 1 from each job)" { Invoke-RestMethod -Uri "$base/inventory/stock/$($partA.id)?location=DAMAGE_LOCATION" -Method Get -Headers $H }
$partBDamage = Step "GET partB DAMAGE_LOCATION stock (expect 2: 1 from each job)" { Invoke-RestMethod -Uri "$base/inventory/stock/$($partB.id)?location=DAMAGE_LOCATION" -Method Get -Headers $H }
Write-Output "partA DAMAGE_LOCATION onHand=$($partADamage.quantityOnHand) | partB DAMAGE_LOCATION onHand=$($partBDamage.quantityOnHand)"

# ============================================================================
# 7. Permissions admin surface: revoke + verify it's actually gone
# ============================================================================
Step "admin revokes the CCE's QC_APPROVAL grant" { Invoke-RestMethod -Uri "$base/permissions/revoke" -Method Post -Headers $H -ContentType "application/json" -Body (@{ userId = $qcUserId; permissionType = "QC_APPROVAL"; notes = "Phase 6 E2E - end of coverage period" } | ConvertTo-Json) } | Out-Null

$jcRevokeCheck = Step "jcVerbal: complete -> READY_FOR_QC (for the post-revoke check)" { Invoke-RestMethod -Uri "$base/workshop/$($jcVerbal.id)/complete" -Method Post -Headers $WH }
ExpectFail "revoked CCE can no longer QC-approve" 403 { Invoke-RestMethod -Uri "$base/job-cards/$($jcVerbal.id)/qc/approve" -Method Post -Headers $QCH }

$history = Step "GET the CCE's full grant history (active + revoked)" { Invoke-RestMethod -Uri "$base/permissions/users/$qcUserId" -Method Get -Headers $H }
Write-Output "grant history entries: $(@($history).Count)"

Write-Output "=== PHASE 6 E2E TEST COMPLETE ==="
