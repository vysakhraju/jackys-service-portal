$ErrorActionPreference = "Stop"
$base = "http://localhost:3000/api/v1"
$suffix = Get-Random -Maximum 99999

function Step($name, $block) {
  try {
    $result = & $block
    Write-Output "OK   $name"
    return $result
  } catch {
    Write-Output "FAIL $name : $($_.ErrorDetails.Message)"
    throw
  }
}

# 1. Login as admin
$resp = Step "login" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"admin@jackys.com","password":"Admin123!"}' }
$tok = $resp.accessToken
$H = @{ Authorization = "Bearer $tok" }

# 2. Master data: service centre, fault/symptom
$sc = Step "create service centre" { Invoke-RestMethod -Uri "$base/master-data/service-centres" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  code = "P4-$suffix"; name = "Phase4 Test Centre"; country = "UAE"; vatRate = 5.0
  schedule = @{ monday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 } }
} | ConvertTo-Json -Depth 5) }

$fs = Step "create fault-symptom" { Invoke-RestMethod -Uri "$base/master-data/fault-symptoms" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  faultCode = "P4F$suffix"; faultDescription = "Test fault"; symptomCode = "P4S$suffix"; symptomDescription = "Test symptom"; category = "WASHING_MACHINE"
} | ConvertTo-Json) }

# 3. Technician
$seedOut = Step "seed technician" { & powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='p4tech$suffix@x.com'; `$env:SEED_TECH_PASSWORD='Pass123!'; npm run seed:technician" }
$techId = ($seedOut | Select-String -Pattern "User id:\s*(\S+)").Matches[0].Groups[1].Value
Write-Output "tech id: $techId"

# 4. Appointment with invoice number, OOW serial (no warranty record for it)
$apt = Step "create appointment" { Invoke-RestMethod -Uri "$base/appointments" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  type = "WARRANTY"; customerType = "B2C"; customerName = "Phase4 Customer"; customerPhone = "+97150$suffix"; customerEmail = "p4customer$suffix@example.com"
  scheduledAt = "2026-08-25T10:00:00Z"; serviceCentreId = $sc.id; brand = "Samsung"; modelNumber = "WA80J5710"; invoiceNumber = "INV-P4-$suffix"
} | ConvertTo-Json) }

Step "assign technician" { Invoke-RestMethod -Uri "$base/appointments/$($apt.id)/assign-technician" -Method Put -Headers $H -ContentType "application/json" -Body (@{ technicianId = $techId } | ConvertTo-Json) } | Out-Null

# 5. Technician flow (login as technician)
$techLogin = Step "login as technician" { Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "p4tech$suffix@x.com"; password = "Pass123!" } | ConvertTo-Json) }
$TH = @{ Authorization = "Bearer $($techLogin.accessToken)" }

Step "start visit" { Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/start" -Method Post -Headers $TH -ContentType "application/json" -Body '{"gpsLat":25.2048,"gpsLng":55.2708}' } | Out-Null
Step "capture serial (OOW - no matching warranty range)" { Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/serial-number" -Method Post -Headers $TH -ContentType "application/json" -Body (@{ serialNumber = "OOWSN$suffix"; brand = "Samsung" } | ConvertTo-Json) } | Out-Null
Step "capture fault-symptom" { Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/fault-symptom" -Method Post -Headers $TH -ContentType "application/json" -Body (@{ faultCode = "P4F$suffix"; symptomCode = "P4S$suffix" } | ConvertTo-Json) } | Out-Null

# 6. Job Card (back to admin)
$jc = Step "create job card" { Invoke-RestMethod -Uri "$base/job-cards" -Method Post -Headers $H -ContentType "application/json" -Body (@{ appointmentId = $apt.id } | ConvertTo-Json) }
Write-Output "job card warrantyStatus: $($jc.warrantyStatus), status: $($jc.status)"

$jc = Step "validate-sn" { Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/validate-sn" -Method Post -Headers $H -ContentType "application/json" -Body '{"matches":true}' }
Write-Output "job card status after validate-sn: $($jc.status)"

# 7. Estimate: create -> send -> reject via public link -> job card RWR
$est = Step "create estimate" { Invoke-RestMethod -Uri "$base/estimates" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  jobCardId = $jc.id
  lineItems = @(@{ description = "Test Part"; quantity = 1; unitPrice = 350 }, @{ description = "Labor"; quantity = 1; unitPrice = 120 })
} | ConvertTo-Json -Depth 5) }
Write-Output "estimate total: $($est.totalAmount), status: $($est.status)"

$est = Step "send estimate" { Invoke-RestMethod -Uri "$base/estimates/$($est.id)/send" -Method Post -Headers $H }
Write-Output "estimate status after send: $($est.status), token present: $([bool]$est.accessToken), channelsAttempted: $($est.channelsAttempted -join ',')"

$publicView = Step "public GET (should succeed, SENT)" { Invoke-RestMethod -Uri "$base/estimates/public/$($est.accessToken)" -Method Get }
Write-Output "public view total: $($publicView.totalAmount)"

$rejected = Step "public respond: reject" { Invoke-RestMethod -Uri "$base/estimates/public/$($est.accessToken)/respond" -Method Post -ContentType "application/json" -Body '{"approved":false,"notes":"Too expensive"}' }
Write-Output "estimate status after reject: $($rejected.status)"

# negative: public GET after response should now 410
try {
  Invoke-RestMethod -Uri "$base/estimates/public/$($est.accessToken)" -Method Get
  Write-Output "FAIL public GET after response: expected 410, got success"
} catch {
  Write-Output "OK   public GET after response correctly failed: $($_.Exception.Response.StatusCode)"
}

# negative: respond again should 409
try {
  Invoke-RestMethod -Uri "$base/estimates/public/$($est.accessToken)/respond" -Method Post -ContentType "application/json" -Body '{"approved":true}'
  Write-Output "FAIL duplicate respond: expected 409, got success"
} catch {
  Write-Output "OK   duplicate respond correctly failed: $($_.Exception.Response.StatusCode)"
}

$jcAfterReject = Step "GET job card (should be RWR)" { Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)" -Method Get -Headers $H }
Write-Output "job card status after reject: $($jcAfterReject.status)"

# negative: warranty-override blocked while RWR
try {
  Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/warranty-override" -Method Post -Headers $H -ContentType "application/json" -Body '{"newStatus":"IN_WARRANTY","reason":"should be blocked while RWR"}'
  Write-Output "FAIL warranty-override while RWR: expected 400, got success"
} catch {
  Write-Output "OK   warranty-override while RWR correctly blocked: $($_.Exception.Response.StatusCode)"
}

# 8. Revise -> new DRAFT, job card back to SN_VALIDATED
$revised = Step "revise estimate" { Invoke-RestMethod -Uri "$base/estimates/$($rejected.id)/revise" -Method Post -Headers $H -ContentType "application/json" -Body '{}' }
Write-Output "revised estimate id: $($revised.id), previousEstimateId: $($revised.previousEstimateId), status: $($revised.status)"

$jcAfterRevise = Step "GET job card (should be SN_VALIDATED again)" { Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)" -Method Get -Headers $H }
Write-Output "job card status after revise: $($jcAfterRevise.status)"

$revised = Step "send revised estimate" { Invoke-RestMethod -Uri "$base/estimates/$($revised.id)/send" -Method Post -Headers $H }

# 9. Staff-recorded approval - wrong contact value first (should 400)
try {
  Invoke-RestMethod -Uri "$base/estimates/$($revised.id)/record-response" -Method Post -Headers $H -ContentType "application/json" -Body '{"approved":true,"contactMethod":"PHONE_CALL","contactValue":"+971500000000","notes":"wrong number test"}'
  Write-Output "FAIL record-response with wrong contact value: expected 400, got success"
} catch {
  Write-Output "OK   record-response with wrong contact value correctly blocked: $($_.Exception.Response.StatusCode)"
}

$approved = Step "record-response: correct contact value, approve" { Invoke-RestMethod -Uri "$base/estimates/$($revised.id)/record-response" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  approved = $true; contactMethod = "PHONE_CALL"; contactValue = "+97150$suffix"; notes = "Called customer, confirmed total, approved to proceed"
} | ConvertTo-Json) }
Write-Output "estimate status after staff-recorded approval: $($approved.status), respondedVia: $($approved.respondedVia)"

$jcAfterApproval = Step "GET job card (customerApproved should be true)" { Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)" -Method Get -Headers $H }
Write-Output "job card customerApproved: $($jcAfterApproval.customerApproved), status: $($jcAfterApproval.status)"

# 10. assign-section should now succeed
$assigned = Step "assign-section (should succeed now)" { Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/assign-section" -Method Post -Headers $H -ContentType "application/json" -Body '{"section":"WORKSHOP"}' }
Write-Output "final job card status: $($assigned.status), section: $($assigned.section)"

Write-Output "=== E2E TEST COMPLETE ==="
