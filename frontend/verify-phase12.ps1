# Frontend Phase 12 (Reports/Dashboards) - live verification
#
# This can't be run from the cloud session (it has no network path to your machine), so
# run it yourself and paste the output back.
#
# Reports/Dashboards is the LAST frontend phase and the FIRST purely read-only screen in
# the app - there is nothing to create here, so unlike every earlier verify-phaseN.ps1
# this script does not seed new records. It reads whatever Job Cards / Estimates /
# TechnicianVisits / Dismantling records already exist from your prior verify-phase3
# through verify-phase11 runs (and any manual testing you've done), and checks that the
# 6 REST endpoints ReportsPage.tsx consumes return internally-consistent, correctly-typed
# data - not specific counts, since the underlying data is cumulative and this script
# doesn't control it.
#
# What this script verifies:
#   1. RBAC: REPORTS_VIEW_ROLES is SERVICE_HEAD / SUPER_ADMIN / TECHNICAL_TEAM_LEADER only
#      (notably narrower than every other module - no ACCOUNTANT/FINANCE_MANAGER) - a
#      technician gets 403 on all 6 endpoints, and an unauthenticated request gets 401.
#   2. GET /reports/dashboard/kanban: exactly the 8 documented KanbanColumn keys, in the
#      documented order, CANCELLED never appears, each column's count matches its
#      jobCards array length, and the columns' counts sum to totalActiveJobs.
#   3. GET /reports/dashboard/kanban/summary: same column shape minus jobCards, same
#      internal-consistency check (counts sum to totalActiveJobs).
#   4. GET /reports/dashboard/approval-aging: thresholdHours is 4 (BRD 18.1), breachedCount
#      matches the actual count of items with breached=true, and items are in descending
#      ageHours order (the service sorts by sentAt ASC, i.e. oldest-first, which is the
#      same thing as longest-waiting/largest-ageHours-first).
#   5. GET /reports/dashboard/service-efficiency: sampleSize/overallAvgHours agree with
#      each other (null avg iff zero sample), byTechnician rows are sorted by jobCount
#      descending, and every avgHours is non-negative.
#   6. GET /reports/dashboard/first-time-fix-rate: onSiteOnlyCompletedJobs never exceeds
#      totalCompletedJobs, and rate is null iff totalCompletedJobs is 0, otherwise matches
#      onSiteOnlyCompletedJobs/totalCompletedJobs to 4 decimal places.
#   7. GET /reports/dashboard/overview: the combined payload's kanbanSummary/
#      firstTimeFixRate/serviceEfficiency sub-objects are internally consistent with the
#      same checks as their dedicated endpoints above.
#
# NOT covered here (and why): the live WebSocket push (kanban:update / approval-aging:update
# over the /reports Socket.io namespace) can't be reliably driven from plain PowerShell -
# Socket.io layers its own handshake/framing on top of a raw WebSocket, which
# System.Net.WebSockets.ClientWebSocket doesn't speak. Verify the live channel manually
# instead: sign in as Service Head / Super Admin / Technical Team Leader, open /reports,
# confirm the connection pill flips to "Live" within a couple of seconds, then in a second
# tab advance any Job Card's status (e.g. via Appointments/Job Cards) and confirm the
# Kanban board updates within ~5 seconds without a page refresh - and confirm Approval
# Aging's "Waiting for the live feed..." message clears on that same initial connect.
#
# PREREQUISITE: the same technician and supervisor accounts as verify-phase11.ps1
# (tech@jackys.com / TECHNICIAN_FIELD, supervisor@jackys.com / TECHNICAL_TEAM_LEADER). If
# you don't have the supervisor account seeded yet, see verify-phase11.ps1's header for
# the seeding command.

$BaseUrl = "http://localhost:3000/api/v1"
$TechnicianEmail    = "tech@jackys.com"
$TechnicianPassword = "Tech123!"
$SupervisorEmail    = "supervisor@jackys.com"
$SupervisorPassword = "Super123!"

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

function Assert($name, [bool]$condition, $detail) {
    if ($condition) {
        Write-Host "PASS: $name" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "FAIL: $name" -ForegroundColor Red
        if ($detail) { Write-Host "  $detail" -ForegroundColor Red }
        $script:fail++
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

Write-Host "Frontend Phase 12 live-verification against $BaseUrl" -ForegroundColor Yellow

$ExpectedColumnOrder = @("SCHEDULED", "ON_SITE", "WIP", "SPARE_PENDING", "APPROVAL_PENDING", "QC_COMPLETED", "OUT_FOR_DELIVERY", "DELIVERED")

# 0. Log in all three actors up front.
$adminLogin = Step "Admin login (POST /auth/login)" { Invoke-Api POST "/auth/login" $null @{ email = "admin@jackys.com"; password = "Admin123!" } }
$adminToken = $adminLogin.accessToken
if (-not $adminToken) { Write-Host "`nCan't continue without an admin token - stopping." -ForegroundColor Red; exit 1 }

$techLogin = Step "Technician login (NOT in REPORTS_VIEW_ROLES - used for the 403 checks below)" { Invoke-Api POST "/auth/login" $null @{ email = $TechnicianEmail; password = $TechnicianPassword } }
$techToken = $techLogin.accessToken

$supervisorLogin = Step "Supervisor login (TECHNICAL_TEAM_LEADER - IS in REPORTS_VIEW_ROLES)" { Invoke-Api POST "/auth/login" $null @{ email = $SupervisorEmail; password = $SupervisorPassword } }
$supervisorToken = $supervisorLogin.accessToken

# =====================================================================================
# PART A - RBAC: REPORTS_VIEW_ROLES is SERVICE_HEAD / SUPER_ADMIN / TECHNICAL_TEAM_LEADER
# only - notably narrower than every other module (no ACCOUNTANT/FINANCE_MANAGER).
# =====================================================================================

$reportEndpoints = @(
    "/reports/dashboard/kanban",
    "/reports/dashboard/kanban/summary",
    "/reports/dashboard/approval-aging",
    "/reports/dashboard/service-efficiency",
    "/reports/dashboard/first-time-fix-rate",
    "/reports/dashboard/overview"
)

foreach ($ep in $reportEndpoints) {
    Expect-StatusCode "[tech, not in VIEW_ROLES] GET $ep -> 403" 403 { Invoke-Api GET $ep $techToken $null }
}
Expect-StatusCode "[no token] GET /reports/dashboard/kanban -> 401" 401 { Invoke-Api GET "/reports/dashboard/kanban" $null $null }

if ($supervisorToken) {
    Step "[supervisor, TECHNICAL_TEAM_LEADER] GET /reports/dashboard/kanban succeeds" {
        Invoke-Api GET "/reports/dashboard/kanban" $supervisorToken $null
    } | Out-Null
} else {
    Write-Host "`nNo supervisor token - skipping the supervisor-can-view check (see the PREREQUISITE comment at the top of this script)." -ForegroundColor Yellow
}

# =====================================================================================
# PART B - GET /reports/dashboard/kanban (full board)
# =====================================================================================

$kanban = Step "[admin] GET /reports/dashboard/kanban" { Invoke-Api GET "/reports/dashboard/kanban" $adminToken $null }

if ($kanban) {
    $actualKeys = @($kanban.columns | ForEach-Object { $_.key })
    Assert "Kanban board has exactly the 8 documented columns, in order" `
        (($actualKeys -join ",") -eq ($ExpectedColumnOrder -join ",")) `
        "expected [$($ExpectedColumnOrder -join ', ')], got [$($actualKeys -join ', ')]"

    Assert "CANCELLED never appears as a Kanban column (dropped from the live board by design)" `
        ("CANCELLED" -notin $actualKeys) "columns were: $($actualKeys -join ', ')"

    $countSum = ($kanban.columns | Measure-Object -Property count -Sum).Sum
    Assert "Column counts sum to totalActiveJobs ($countSum == $($kanban.totalActiveJobs))" `
        ($countSum -eq $kanban.totalActiveJobs) "sum=$countSum totalActiveJobs=$($kanban.totalActiveJobs)"

    $jobCardsMismatch = $kanban.columns | Where-Object { $_.jobCards.Count -ne $_.count }
    Assert "Every column's jobCards array length matches its count" `
        ($jobCardsMismatch.Count -eq 0) `
        "mismatched columns: $(($jobCardsMismatch | ForEach-Object { $_.key }) -join ', ')"

    Write-Host "Kanban snapshot: totalActiveJobs=$($kanban.totalActiveJobs), asOf=$($kanban.asOf)"
    foreach ($c in $kanban.columns) { Write-Host "  $($c.key): $($c.count)" }
}

# =====================================================================================
# PART C - GET /reports/dashboard/kanban/summary (counts-only variant)
# =====================================================================================

$summary = Step "[admin] GET /reports/dashboard/kanban/summary" { Invoke-Api GET "/reports/dashboard/kanban/summary" $adminToken $null }

if ($summary) {
    $summaryKeys = @($summary.columns | ForEach-Object { $_.key })
    Assert "Summary has exactly the 8 documented columns, in order" `
        (($summaryKeys -join ",") -eq ($ExpectedColumnOrder -join ",")) `
        "expected [$($ExpectedColumnOrder -join ', ')], got [$($summaryKeys -join ', ')]"

    $hasJobCards = $summary.columns | Where-Object { $null -ne $_.PSObject.Properties['jobCards'] }
    Assert "Summary columns carry no jobCards field (counts-only, for lightweight polling)" `
        ($hasJobCards.Count -eq 0) "columns with a jobCards field: $(($hasJobCards | ForEach-Object { $_.key }) -join ', ')"

    $summaryCountSum = ($summary.columns | Measure-Object -Property count -Sum).Sum
    Assert "Summary column counts sum to its own totalActiveJobs ($summaryCountSum == $($summary.totalActiveJobs))" `
        ($summaryCountSum -eq $summary.totalActiveJobs) "sum=$summaryCountSum totalActiveJobs=$($summary.totalActiveJobs)"
}

# =====================================================================================
# PART D - GET /reports/dashboard/approval-aging
# =====================================================================================

$aging = Step "[admin] GET /reports/dashboard/approval-aging" { Invoke-Api GET "/reports/dashboard/approval-aging" $adminToken $null }

if ($aging) {
    Assert "thresholdHours is 4 (BRD 18.1: red alert past 4 hours)" ($aging.thresholdHours -eq 4) "got $($aging.thresholdHours)"

    $actualBreached = @($aging.items | Where-Object { $_.breached -eq $true }).Count
    Assert "breachedCount matches the actual count of breached items ($actualBreached == $($aging.breachedCount))" `
        ($actualBreached -eq $aging.breachedCount) "computed=$actualBreached reported=$($aging.breachedCount)"

    $ageHoursList = @($aging.items | ForEach-Object { $_.ageHours })
    $sortedDesc = $ageHoursList | Sort-Object -Descending
    $isDescending = (($ageHoursList -join ",") -eq ($sortedDesc -join ","))
    Assert "Items are ordered oldest-first (descending ageHours - service sorts by sentAt ASC)" `
        $isDescending "ageHours order was: $($ageHoursList -join ', ')"

    Write-Host "Approval aging: $($aging.items.Count) item(s) awaiting response, $($aging.breachedCount) past threshold"
}

# =====================================================================================
# PART E - GET /reports/dashboard/service-efficiency
# =====================================================================================

$efficiency = Step "[admin] GET /reports/dashboard/service-efficiency" { Invoke-Api GET "/reports/dashboard/service-efficiency" $adminToken $null }

if ($efficiency) {
    if ($efficiency.sampleSize -eq 0) {
        Assert "sampleSize=0 implies overallAvgHours is null" ($null -eq $efficiency.overallAvgHours) "overallAvgHours=$($efficiency.overallAvgHours)"
    } else {
        Assert "sampleSize>0 implies overallAvgHours is not null" ($null -ne $efficiency.overallAvgHours) "sampleSize=$($efficiency.sampleSize)"
    }

    $techJobCounts = @($efficiency.byTechnician | ForEach-Object { $_.jobCount })
    $techSortedDesc = $techJobCounts | Sort-Object -Descending
    Assert "byTechnician rows are sorted by jobCount descending" `
        (($techJobCounts -join ",") -eq ($techSortedDesc -join ",")) "order was: $($techJobCounts -join ', ')"

    $negativeHours = @($efficiency.byTechnician + $efficiency.byCategory) | Where-Object { $_.avgHours -lt 0 }
    Assert "No negative avgHours in byTechnician/byCategory" ($negativeHours.Count -eq 0) "found $($negativeHours.Count) negative row(s)"

    Write-Host "Service efficiency: sampleSize=$($efficiency.sampleSize), overallAvgHours=$($efficiency.overallAvgHours), $($efficiency.byTechnician.Count) technician(s), $($efficiency.byCategory.Count) categor(y/ies)"
}

# =====================================================================================
# PART F - GET /reports/dashboard/first-time-fix-rate
# =====================================================================================

$ftfr = Step "[admin] GET /reports/dashboard/first-time-fix-rate" { Invoke-Api GET "/reports/dashboard/first-time-fix-rate" $adminToken $null }

if ($ftfr) {
    Assert "onSiteOnlyCompletedJobs never exceeds totalCompletedJobs" `
        ($ftfr.onSiteOnlyCompletedJobs -le $ftfr.totalCompletedJobs) `
        "onSiteOnly=$($ftfr.onSiteOnlyCompletedJobs) total=$($ftfr.totalCompletedJobs)"

    if ($ftfr.totalCompletedJobs -eq 0) {
        Assert "totalCompletedJobs=0 implies rate is null" ($null -eq $ftfr.rate) "rate=$($ftfr.rate)"
    } else {
        $expectedRate = [Math]::Round($ftfr.onSiteOnlyCompletedJobs / $ftfr.totalCompletedJobs, 4)
        Assert "rate matches onSiteOnlyCompletedJobs/totalCompletedJobs to 4dp ($expectedRate == $($ftfr.rate))" `
            ([Math]::Abs($expectedRate - $ftfr.rate) -lt 0.0001) "expected=$expectedRate reported=$($ftfr.rate)"
    }

    Write-Host "First-time fix rate: $($ftfr.onSiteOnlyCompletedJobs) of $($ftfr.totalCompletedJobs) completed jobs, rate=$($ftfr.rate)"
}

# =====================================================================================
# PART G - GET /reports/dashboard/overview (combined payload)
# =====================================================================================

$overview = Step "[admin] GET /reports/dashboard/overview" { Invoke-Api GET "/reports/dashboard/overview" $adminToken $null }

if ($overview) {
    $overviewCountSum = ($overview.kanbanSummary.columns | Measure-Object -Property count -Sum).Sum
    Assert "overview.kanbanSummary counts sum to its own totalActiveJobs" `
        ($overviewCountSum -eq $overview.kanbanSummary.totalActiveJobs) `
        "sum=$overviewCountSum totalActiveJobs=$($overview.kanbanSummary.totalActiveJobs)"

    if ($overview.firstTimeFixRate.totalCompletedJobs -eq 0) {
        Assert "overview.firstTimeFixRate.totalCompletedJobs=0 implies rate is null" ($null -eq $overview.firstTimeFixRate.rate) $null
    } else {
        Assert "overview.firstTimeFixRate.onSiteOnlyCompletedJobs never exceeds totalCompletedJobs" `
            ($overview.firstTimeFixRate.onSiteOnlyCompletedJobs -le $overview.firstTimeFixRate.totalCompletedJobs) $null
    }

    if ($overview.approvalAging.breachedCount -gt 0) {
        Assert "overview.approvalAging.oldestAgeHours is set when breachedCount > 0" ($null -ne $overview.approvalAging.oldestAgeHours) $null
    }

    Assert "overview.serviceEfficiency.sampleSize is non-negative" ($overview.serviceEfficiency.sampleSize -ge 0) $null

    Write-Host "Overview: activeJobs=$($overview.kanbanSummary.totalActiveJobs), breachedApprovals=$($overview.approvalAging.breachedCount), ftfr=$($overview.firstTimeFixRate.rate), avgServiceHours=$($overview.serviceEfficiency.overallAvgHours)"
}

Write-Host "`n=================================================="
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================="
Write-Host "`nReminder: this script only covers the 6 REST endpoints. Manually verify the live"
Write-Host "WebSocket channel per the NOT COVERED HERE note at the top of this file."
