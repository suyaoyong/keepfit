# 云数据库集合与字段规范

## auth
- openid
- nickName
- avatarUrl
- scope
- status
- updatedAt

## profile
- openid
- createdAt
- updatedAt
- abilityLevel
- trainingFrequency
- sessionDuration
- injuryNotes

## plans
- openid
- planId
- planName
- planType (自建/推荐)
- planLevel (初试身手/渐入佳境/炉火纯青/闭关修炼/登峰造极)
- weeklySessions
- setsRange
- exerciseScope (four/six)
- scheduleType (week/month/calendar)
- status (active/paused/archived)
- startLevels (per exercise)
- recommendationId
- createdAt
- updatedAt

## plan_rules
- ruleId
- planId
- planName
- weeklySessions
- exerciseScope
- exercises
- setsRange
- version
- updatedAt

## methods
- methodId
- exerciseId
- exerciseName
- level
- levelName
- method
- targets
- version
- updatedAt

## schedules
- scheduleId
- openid
- planId
- date (YYYY-MM-DD)
- exercises
- targets
- status (planned/completed/skipped)
- swapped (boolean)
- updatedAt

## workouts
- openid
- date (YYYY-MM-DD)
- workoutId
- exerciseId
- sets
- reps
- duration
- rpe
- notes
- createdAt
- updatedAt

## diaries
- diaryId
- openid
- date (YYYY-MM-DD)
- exerciseId
- sets
- reps
- duration
- rpe
- notes
- createdAt

## progress
- openid
- exerciseId
- currentStage
- nextStage
- unlockCondition
- updatedAt

## 索引建议
- workouts: openid + date + exerciseId
- plans: openid + status
- progress: openid + exerciseId
- schedules: openid + date
- diaries: openid + date
- plan_rules: version
- methods: version

