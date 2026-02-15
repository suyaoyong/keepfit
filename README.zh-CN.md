# KeepFit 微信小程序（中文版）

这是 KeepFit 的中文说明文档。项目基于《囚徒健身》训练体系，提供训练计划、记录、进度跟踪、问题反馈与 EPUB 阅读能力。

## 功能概览
- 主流程页面：今日训练 / 进度 / 我的
- 训练计划与云端排期保存
- 当日训练记录与历史补录
- 进度日历与阶段进阶显示
- 问题反馈（写入集合 feedback）
- EPUB 书库、目录、章节阅读、阅读进度保存
- 章节插图支持：自动提取 / 上传 / 渲染
- 阅读页图片自适应宽度，点击可放大预览

## 目录结构
- `miniprogram/`：小程序前端
- `cloudfunctions/`：云函数
- `tools/`：导入与数据处理脚本
- `specs/`：规格、任务、worklog

## 快速开始
1. 使用微信开发者工具打开仓库。
2. 确认云环境 ID 与 `miniprogram/app.js` 一致。
3. 部署云函数：`auth` `plan` `schedule` `workout` `progress` `diary` `profile` `feedback` `library` `ai-parse`
4. 创建集合：`auth` `profile` `plans` `schedules` `workouts` `diaries` `progress` `feedback` `books` `book_chapters` `book_progress`
5. 编译并真机预览。

## EPUB 导入（封面 + 插图）
1. 预处理 EPUB：
   - `python tools/epub_to_cloud_json.py --epub "<your-book>.epub" --out "data/epub-import/qiutu" --book-id "qiutujianshen"`
2. 同步 seed 文件到 `cloudfunctions/library/seed/`。
3. 重新部署 `library` 云函数（建议超时 60~120 秒）。
4. 在云函数测试中执行：`{ "action": "seedQiutu" }`。

## 常见问题
- `seedQiutu` 3 秒超时：请提高 `library` 函数超时时间后重试。
- `feedback collection not exists`：请先创建 `feedback` 集合。
- 有封面无正文插图：请重新部署 `library` 并再执行一次 `seedQiutu`。

## 说明
- 英文详细文档请参考 `README.md`。
- 本文档与英文版将同步维护。
