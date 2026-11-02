# Obsidian 目录说明

## 路径来源

不再固定某个盘符，全部来自 `.env`：

```dotenv
OBSIDIAN_VAULT_PATH=<你的 vault 绝对路径>
OBSIDIAN_INBOX_DIR=000-Inbox\001-信息中心
OBSIDIAN_PLATFORM_DIR_MAP={"抖音":"抖音","B站":"B站","微信公众号":"公众号","X":"推特","YouTube":"YouTube"}
```

未填写 `OBSIDIAN_VAULT_PATH` 时 Worker 启动失败并提示。

## 目录结构

```text
<OBSIDIAN_VAULT_PATH>\<OBSIDIAN_INBOX_DIR>\
├── 抖音
├── B站
├── 公众号
├── 推特
└── YouTube
```

目录不存在时首次运行会自动创建。小红书未实现，不会写入。

## 文件命名

```text
<标题> - <作品ID后 8 位字母数字>.md
```

## 图片归档

```text
<平台>\_assets\<sha256(去重ID) 前 16 位>\<三位序号>-<哈希>.<扩展名>
```

同目录下的 manifest 记录已下载图片，重复处理不会重复下载。

## 写入行为

- 原子写入（先写临时文件再重命名）；
- 相同内容幂等跳过；
- 用户修改过内容时跳过覆盖，并记为 `existing_note_modified`。
