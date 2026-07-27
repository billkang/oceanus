# 容器图 (C4 Level 2)

> 展示系统内部的运行单元及其关系。

```mermaid
flowchart TD
    subgraph "前端"
        WEB[("Web 应用<br/>Container: Angular/React/Vue")]
    end
    subgraph "后端"
        API[("API 服务<br/>Container: Spring Boot/NestJS/FastAPI")]
        WORKER[("后台任务<br/>Container: 可选")]
    end
    subgraph "存储"
        DB[(("主数据库<br/>Container: PostgreSQL"))]
        CACHE[(("缓存<br/>Container: Redis/可选"))]
    end
    subgraph "外部"
        EXT[("第三方服务<br/>External")]
    end

    WEB -->|"HTTP/REST"| API
    API <-->|"JDBC/ORM"| DB
    API <-->|"协议"| CACHE
    API <-->|"API 调用"| EXT
    WORKER -->|"异步处理"| API
```

## 容器

| 容器         | 技术                       | 职责       |
| ------------ | -------------------------- | ---------- |
| Web 应用     | Angular/React/Vue          | 用户界面   |
| API 服务     | Spring Boot/NestJS/FastAPI | 业务逻辑层 |
| 主数据库     | PostgreSQL                 | 持久化存储 |
| 缓存（可选） | Redis                      | 高速缓存   |

## 通信方式

- 前端 ↔ 后端：HTTP/REST (JSON)
- 后端 ↔ 数据库：ORM / JDBC

## 更新记录

| 日期   | 更新内容 | 更新人 |
| ------ | -------- | ------ |
| {date} | 初始创建 | —      |
