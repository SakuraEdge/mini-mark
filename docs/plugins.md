# Mini Mark 插件开发

插件是一个 UTF-8 JavaScript 文件。通过“更多 → 插件”导入文件，或选择“新建”修改内置写作工具示例，然后保存。支持启用、停用、移除和源码导出。插件代码只在保存检查或手动执行命令时运行，不在应用启动时执行。

## 最小插件

```js
miniMark.register({
  id: 'my-tools',
  name: '我的工具',
  version: '1.0.0',
  commands: [
    {
      id: 'uppercase',
      title: '选中文字转大写',
      run(context) {
        return { replaceSelection: context.selectedText.toUpperCase() };
      },
    },
  ],
});
```

`id` 必须以小写字母开头，其余可用小写字母、数字、点号、连字符，最长 64 个字符。一个文件注册一个插件，一个插件最多 30 个命令，命令 id 不可重复。文件最多 200,000 个字符，最多保存 50 个插件。

完整示例：`src/features/plugins/writing-tools.js`，包含插入日期、选区引用和文档统计。

## 命令上下文

`run(context)` 可以返回对象，也可以返回 Promise。每次执行都创建新的 Worker，普通全局变量不会跨次保留。

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| `text` | string | 执行时当前文档的完整正文，换行统一为 LF |
| `selectedText` | string | 当前选区文字 |
| `selection` | `{from, to}` | UTF-16 字符偏移，与 JavaScript 字符串索引一致 |
| `name` | string | 当前文档显示名称，不包含磁盘目录 |
| `language` | string | `markdown` 或 `yaml` |
| `state` | JSON 值或 undefined | 上次成功执行返回的插件私有状态 |

## 返回结果

返回 `undefined` 或 `{}` 表示不做修改。以下字段均为可选，其他字段不接受。

| 字段 | 类型 | 行为 |
| --- | --- | --- |
| `replaceSelection` | string | 替换原选区；空选区时插入 |
| `replaceDocument` | string | 替换当前文档全部正文 |
| `message` | string | 提示消息，最多 500 字符 |
| `panel` | `{title, text}` | 展示纯文本结果，不执行 HTML；正文最多 100,000 字符 |
| `state` | JSON 值 | 持久化插件状态，序列化后最多 64 KB 字符 |

两种替换方式不能同时返回；替换正文最多 2,000,000 字符。每次命令修改对应一次独立撤销。不允许在阅读模式改写文档；执行期间切换文档、修改正文或进入输入法组合状态，返回的修改会被拒绝。

```js
async run(context) {
  return {
    message: '已记录次数',
    state: { count: (context.state?.count || 0) + 1 },
  };
}
```

## 运行边界

- 在无同源权限的 sandbox iframe 中创建 Worker，不在编辑器主线程执行用户源码。
- 只向本次命令传入当前文档快照，不开放原生消息桥、任意文件读写、界面 DOM、账号凭据或网络 API 权限。
- CSP 禁止联网；每次执行包含加载时间最多 4 秒，超时移除运行环境。
- 插件仅能通过上表的返回值请求修改文档、显示纯文本结果或保存插件私有状态。
- 这不是操作系统级安全沙箱。仍应仅安装自己编写或已检查的源码；恶意代码的极端内存消耗不属于当前保证范围。
- 当前不支持第三方依赖导入、自定义原生窗口、联网插件、后台常驻插件、Markdown 渲染器替换或自动运行钩子。

插件源码、启用状态和私有状态保存在本机 WebView 存储中，随应用数据目录备份。查看或导入他人文档不会自动安装或执行插件。
