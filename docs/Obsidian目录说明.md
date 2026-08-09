# Obsidian 目录说明

## 固定目录结构
```
<YOUR_OBSIDIAN_VAULT>\000-Inbox\001-信息中心\
├── 抖音        ← 当前已实现采集
├── B站         （目录预留）
├── 小红书      （目录预留）
├── 推特        （目录预留）
├── YouTube     （目录预留）
└── 公众号      （目录预留）
```

## 文件命名
`<笔记标题> - <完整平台作品ID>.md`

## 写入行为
- 原子写入（tmp → rename）
- 不覆盖用户修改（SHA-256 比对）
- 相同内容幂等跳过

## 配置
在 `.env` 中设置:
```
OBSIDIAN_INBOX_DIR=000-Inbox/001-信息中心
OBSIDIAN_PLATFORM_DIR_MAP={"抖音":"抖音",...}
```
