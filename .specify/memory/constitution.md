# 项目宪法（Constitution）

## 目标
- 交付能满足规格的可运行小程序功能设计与实施规划。
- 产物以规格为中心，避免偏离需求或引入不必要复杂度。

## 范围与边界
- 不新增与《囚徒健身》训练计划无关的功能。
- 不引入社交、排行或竞赛类需求。
- 推荐计划仅基于用户填写的训练基础信息与体系规则，不涉及外部数据。

## 项目约束（微信云开发模板）
- 以微信开发者工具云开发模板为基础进行删改。
- 不新建 project.config.json。
- 不修改 appid 与云开发环境配置。
- 允许修改与新增范围：miniprogram/pages、miniprogram/services、miniprogram/app.json、miniprogram/data、cloudfunctions/*。
- 云函数目录策略：新增独立云函数目录（profile、recommendation、plan、workout、progress、auth），保留模板 quickstartFunctions 不做改动。

## 质量原则
- 计划与设计产物必须可追溯到规格条目。
- 文档需清晰、可执行、可验证。
- 所有产物使用中文，UTF-8 编码。

## 风险控制
- 如规格存在不明确处，优先在 research 中记录并给出可行方案。
- 对隐私与数据隔离保持保守设计。

