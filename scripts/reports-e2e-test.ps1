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
# BRD 18.1 Reports/Dashboards - REST + WebSocket live verification.
# ============================================================================

Write-Host "--- seeding a role NOT in reports' VIEW_ROLES (idempotent) ---"
$env:SEED_TECH_EMAIL = "reports-outsider-$suffix@jackys.com"; $env:SEED_TECH_PASSWORD = "Outsider123!"; $env:SEED_TECH_ROLE = "TECHNICIAN_FIELD"
npm run seed:technician 2>&1 | Out-Null
Remove-Item Env:\SEED_TECH_EMAIL, Env:\SEED_TECH_PASSWORD, Env:\SEED_TECH_ROLE -ErrorAction SilentlyContinue

$adminResp = Step "login as admin (SUPER_ADMIN - in VIEW_ROLES)" {
  Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -TimeoutSec 15 -Body '{"email":"admin@jackys.com","password":"Admin123!"}'
}
$adminToken = $adminResp.accessToken
$Hadmin = @{ Authorization = "Bearer $adminToken" }

$outsiderResp = Step "login as outsider (TECHNICIAN_FIELD - NOT in VIEW_ROLES)" {
  Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -TimeoutSec 15 -Body (@{ email = "reports-outsider-$suffix@jackys.com"; password = "Outsider123!" } | ConvertTo-Json)
}
$outsiderToken = $outsiderResp.accessToken
$Houtsider = @{ Authorization = "Bearer $outsiderToken" }

# ----------------------------------------------------------------------------
# REST: all 6 endpoints return 200 with a shape-sane payload for an admin
# ----------------------------------------------------------------------------
$kanban = Step "GET dashboard/kanban" { Invoke-RestMethod -Uri "$base/reports/dashboard/kanban" -Headers $Hadmin -TimeoutSec 15 }
if ($kanban.columns.Count -ne 8) { Write-Host "FAIL kanban: expected 8 columns, got $($kanban.columns.Count)" } else { Write-Host "OK   kanban: 8 columns, totalActiveJobs=$($kanban.totalActiveJobs)" }

$summary = Step "GET dashboard/kanban/summary" { Invoke-RestMethod -Uri "$base/reports/dashboard/kanban/summary" -Headers $Hadmin -TimeoutSec 15 }
if ($summary.totalActiveJobs -ne $kanban.totalActiveJobs) { Write-Host "FAIL summary: totalActiveJobs mismatch vs full board ($($summary.totalActiveJobs) vs $($kanban.totalActiveJobs))" } else { Write-Host "OK   summary matches full board totalActiveJobs" }

$aging = Step "GET dashboard/approval-aging" { Invoke-RestMethod -Uri "$base/reports/dashboard/approval-aging" -Headers $Hadmin -TimeoutSec 15 }
Write-Host "OK   approval-aging: thresholdHours=$($aging.thresholdHours) breachedCount=$($aging.breachedCount)"

$efficiency = Step "GET dashboard/service-efficiency" { Invoke-RestMethod -Uri "$base/reports/dashboard/service-efficiency" -Headers $Hadmin -TimeoutSec 15 }
Write-Host "OK   service-efficiency: sampleSize=$($efficiency.sampleSize) overallAvgHours=$($efficiency.overallAvgHours)"

$fixRate = Step "GET dashboard/first-time-fix-rate" { Invoke-RestMethod -Uri "$base/reports/dashboard/first-time-fix-rate" -Headers $Hadmin -TimeoutSec 15 }
Write-Host "OK   first-time-fix-rate: totalCompletedJobs=$($fixRate.totalCompletedJobs) rate=$($fixRate.rate)"

$overview = Step "GET dashboard/overview" { Invoke-RestMethod -Uri "$base/reports/dashboard/overview" -Headers $Hadmin -TimeoutSec 15 }
if ($overview.kanbanSummary.totalActiveJobs -ne $kanban.totalActiveJobs) { Write-Host "FAIL overview: kanbanSummary mismatch" } else { Write-Host "OK   overview composes all four widgets consistently" }

# ----------------------------------------------------------------------------
# RBAC: unauthenticated -> 401, wrong role -> 403
# ----------------------------------------------------------------------------
ExpectFail "GET dashboard/overview with no token" 401 { Invoke-RestMethod -Uri "$base/reports/dashboard/overview" -TimeoutSec 15 }
ExpectFail "GET dashboard/overview as TECHNICIAN_FIELD (not in VIEW_ROLES)" 403 { Invoke-RestMethod -Uri "$base/reports/dashboard/overview" -Headers $Houtsider -TimeoutSec 15 }

# ----------------------------------------------------------------------------
# WebSocket: admin gets an authenticated snapshot; outsider is rejected+disconnected
# ----------------------------------------------------------------------------
# node's own stderr lines (e.g. the outsider's expected "SOCKET_ERROR Unauthorized") surface to
# PowerShell as native-command error records; under $ErrorActionPreference="Stop" that would abort
# the script before the JSON summary line is captured, even though the rejection is correct
# behavior, not a failure - so relax to Continue for just these two external-process calls.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"

Write-Host "--- WebSocket: admin (permitted) ---"
$wsAdminOut = node scripts/reports-ws-test.js $adminToken 2>&1 | Out-String
Write-Host $wsAdminOut
if ($wsAdminOut -match '"gotKanban":true,"gotAging":true,"code":0') { Write-Host "OK   WS admin received both kanban:update and approval-aging:update on connect" } else { Write-Host "FAIL WS admin did not receive expected events" }

Write-Host "--- WebSocket: outsider (not permitted) ---"
$wsOutsiderOut = node scripts/reports-ws-test.js $outsiderToken 2>&1 | Out-String
Write-Host $wsOutsiderOut
if ($wsOutsiderOut -match 'Unauthorized' -and $wsOutsiderOut -match '"gotKanban":false') { Write-Host "OK   WS outsider correctly rejected and disconnected" } else { Write-Host "FAIL WS outsider was not rejected as expected" }

$ErrorActionPreference = $prevEap

Write-Host "--- Reports/Dashboards E2E complete ---"
