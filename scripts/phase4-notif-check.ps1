$ErrorActionPreference = "Stop"
$base = "http://localhost:3000/api/v1"
$suffix = Get-Random -Maximum 99999

$resp = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"admin@jackys.com","password":"Admin123!"}'
$H = @{ Authorization = "Bearer $($resp.accessToken)" }

$tmpl = Invoke-RestMethod -Uri "$base/master-data/notification-templates" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  trigger = "ESTIMATE_SENT"; channel = "EMAIL"; subject = "Your Estimate {{jobCardNumber}}"; body = "Hi {{customerName}}, total is {{totalAmount}}."; placeholders = @("jobCardNumber","customerName","totalAmount"); isActive = $true
} | ConvertTo-Json)
Write-Output "template created: $($tmpl.id)"

$sc = Invoke-RestMethod -Uri "$base/master-data/service-centres" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  code = "P4N-$suffix"; name = "Phase4 Notif Centre"; country = "UAE"
  schedule = @{ monday = @{ isOpen = $true; startTime = "09:00"; endTime = "18:00"; breakStart = "13:00"; breakEnd = "14:00"; maxJobsPerDay = 20 } }
} | ConvertTo-Json -Depth 5)
$fs = Invoke-RestMethod -Uri "$base/master-data/fault-symptoms" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  faultCode = "P4NF$suffix"; faultDescription = "t"; symptomCode = "P4NS$suffix"; symptomDescription = "t"; category = "WASHING_MACHINE"
} | ConvertTo-Json)

& powershell -Command "cd 'D:\Jackys\jackys service portal'; `$env:SEED_TECH_EMAIL='p4ntech$suffix@x.com'; `$env:SEED_TECH_PASSWORD='Pass123!'; npm run seed:technician" | Out-Null
$techLogin = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "p4ntech$suffix@x.com"; password = "Pass123!" } | ConvertTo-Json)
$techId = (Invoke-RestMethod -Uri "$base/auth/profile" -Headers @{ Authorization = "Bearer $($techLogin.accessToken)" }).id

$apt = Invoke-RestMethod -Uri "$base/appointments" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  type = "WARRANTY"; customerType = "B2C"; customerName = "Notif Test"; customerPhone = "+97151$suffix"; customerEmail = "notif$suffix@example.com"
  scheduledAt = "2026-08-25T10:00:00Z"; serviceCentreId = $sc.id; brand = "Samsung"; modelNumber = "WA80J5710"; invoiceNumber = "INV-P4N-$suffix"
} | ConvertTo-Json)
Invoke-RestMethod -Uri "$base/appointments/$($apt.id)/assign-technician" -Method Put -Headers $H -ContentType "application/json" -Body (@{ technicianId = $techId } | ConvertTo-Json) | Out-Null

$TH = @{ Authorization = "Bearer $($techLogin.accessToken)" }
Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/start" -Method Post -Headers $TH -ContentType "application/json" -Body '{"gpsLat":25.2,"gpsLng":55.2}' | Out-Null
Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/serial-number" -Method Post -Headers $TH -ContentType "application/json" -Body (@{ serialNumber = "OOWSNN$suffix"; brand = "Samsung" } | ConvertTo-Json) | Out-Null
Invoke-RestMethod -Uri "$base/technician/visits/$($apt.id)/fault-symptom" -Method Post -Headers $TH -ContentType "application/json" -Body (@{ faultCode = "P4NF$suffix"; symptomCode = "P4NS$suffix" } | ConvertTo-Json) | Out-Null

$jc = Invoke-RestMethod -Uri "$base/job-cards" -Method Post -Headers $H -ContentType "application/json" -Body (@{ appointmentId = $apt.id } | ConvertTo-Json)
Invoke-RestMethod -Uri "$base/job-cards/$($jc.id)/validate-sn" -Method Post -Headers $H -ContentType "application/json" -Body '{"matches":true}' | Out-Null

$est = Invoke-RestMethod -Uri "$base/estimates" -Method Post -Headers $H -ContentType "application/json" -Body (@{
  jobCardId = $jc.id; lineItems = @(@{ description = "Part"; quantity = 1; unitPrice = 200 })
} | ConvertTo-Json -Depth 5)
$sent = Invoke-RestMethod -Uri "$base/estimates/$($est.id)/send" -Method Post -Headers $H

Write-Output "channelsAttempted: $($sent.channelsAttempted -join ',')"
Write-Output "channelsDelivered: $($sent.channelsDelivered -join ',')"
