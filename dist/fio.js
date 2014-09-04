/**
 * @fileOverview
 *
 * FIO 核心代码
 *
 * @author techird, Baidu FEX.
 *
 */

(function(Promise) {

    var fio = {
        version: '1.0'
    };

    /* 三个主要的命名空间 */
    fio.provider = {};
    fio.file = {};
    fio.user = {};


    /* IO 提供方列表 */
    var providerMap = {};

    /* FIO 当前使用的 IO 提供方 */
    var currentProvider = null;

    /* 返回值为空的 Promise */
    var noop = function() {
        return new Promise.resolve(null);
    };

    /* FIO 当前的用户系统实现 */
    var userImpl = {
        check: noop,
        login: noop,
        logout: noop,
        init: noop,
        current: noop
    };


    /* 数据结构：表示一个用户 */
    function User(id, username) {
        this.id = id;
        this.username = username;
    }

    /* 数据结构：表示一份数据 */
    function Data(content) {
        this.content = content;

        if (content instanceof Blob) {
            this.type = fio.file.TYPE_BLOB;
        } else if (typeof(content) == 'string') {
            this.type = fio.file.TYPE_TEXT;
        } else if (typeof(content) == 'object') {
            this.type = fio.file.TYPE_JSON;
        } else {
            this.type = fio.file.TYPE_UNKNOWN;
        }
    }

    /* 数据结构：表示一个文件或目录 */
    function File(path) {
        this.setPath(path);
        this.isDir = false;
        this.data = null;
        this.size = 0;
        this.createTime = new Date();
        this.modifyTime = new Date();
    }

    File.prototype.setPath = function(path) {
        fio.file.anlysisPath(path, this);
    };

    fio.file.anlysisPath = function(path, fill) {
        fill = fill || {};

        var pathParts = path.split('/');

        // trim start
        while (pathParts[0] == '/' || pathParts[0] === '') {
            pathParts.shift();
        }

        // trim end
        while (pathParts[pathParts.length - 1] == '/' || pathParts[pathParts.length - 1] === '') {
            pathParts.pop();
        }

        fill.filename = pathParts.pop() || null;

        if (pathParts.length) {
            fill.parentPath = '/' + pathParts.join('/') + '/';
        } else {
            fill.parentPath = fill.filename ? '/' : null;
        }

        if (fill.filename) {
            var filenameParts = fill.filename.split('.');

            if (filenameParts.length > 1) {
                fill.extension = '.' + filenameParts.pop();
            } else {
                fill.extension = null;
            }

            fill.name = filenameParts.join('.');
            fill.path = fill.parentPath + fill.filename;
        } else {
            fill.path = '/';
        }

        return fill;
    };

    /* 数据结构：表示一个访问控制列表记录 */
    function Acl(user, file, access) {
        this.user = user;
        this.file = file;
        this.access = access || 0;
    }

    /* 数据结构：表示一个文件操作请求 */
    function FileRequest(path, method, user) {
        this.path = path;
        this.method = method;
        this.user = user;
        this.dupPolicy = fio.file.DUP_FAIL;
        this.newPath = null;
        this.acl = null;
        this.extra = null;
        this.dataType = fio.file.TYPE_TEXT;
    }

    /* 暴露需要的数据结构 */
    fio.user.User = User;
    fio.file.Data = Data;
    fio.file.File = File;
    fio.file.Acl = Acl;
    fio.file.FileRequest = FileRequest;

    /* 数据类型常量枚举 */
    fio.file.TYPE_TEXT = 'text';
    fio.file.TYPE_JSON = 'json';
    fio.file.TYPE_BLOB = 'blob';
    fio.file.TYPE_UNKNOWN = 'unknown';

    /* 文件操作常量枚举 */
    fio.file.METHOD_READ = 'read';
    fio.file.METHOD_WRITE = 'write';
    fio.file.METHOD_LIST = 'list';
    fio.file.METHOD_MOVE = 'move';
    fio.file.METHOD_DELETE = 'delete';
    fio.file.METHOD_MKDIR = 'mkdir';
    fio.file.METHOD_ACL_READ = 'readAcl';
    fio.file.METHOD_ACL_WRITE = 'writeAcl';

    /* 文件重复处理策略枚举 */
    fio.file.DUP_OVERWRITE = 'overwrite';
    fio.file.DUP_FAIL = 'fail';
    fio.file.DUP_RENAME = 'rename';

    /* 权限枚举 */
    fio.file.ACCESS_PUBLIC = 0x0001;
    fio.file.ACCESS_READ = 0x0002;
    fio.file.ACCESS_WRITE = 0x0004;
    fio.file.ACCESS_CREATE = 0x0008;
    fio.file.ACCESS_DELETE = 0x0010;
    fio.file.ACCESS_ACL_READ = 0x0020;
    fio.file.ACCESS_ACL_WRITE = 0x0040;
    fio.file.ACCESS_ALL = 0xfffe;

    /**
     * 注册一个 IO 提供方
     *
     * @method fio.provider.register
     *
     * @grammer fio.provider.register(name, provider)
     *
     * @param  {string} name
     *     提供方的名称
     *
     * @param  {object} provider
     *     提供方的实现
     *
     *     provider.init(opt) {function(object)}
     *         提供方的初始化方法，客户调用 fio.provider.init() 的时候会调用
     *
     *     provider.handle(request) {function(fio.file.FileRequest)}
     *         提供方处理文件请求的方法，根据 request.method 的不同取值返回不同的 Promise：
     *
     *             取值为 `fio.file.METHOD_LIST` 返回 Promise<fio.file.File[]>
     *             取值为 `fio.file.METHOD_ACL_READ` 返回 Promise<fio.file.ACL[]>
     *             取值为  `fio.file.METHOD_ACL_WRITE` 返回 Promise<fio.file.ACL[]>
     *             其他取值返回 `Promise<fio.file.File>`
     *
     * @see #fio.file.FileRequest
     *
     * @example
     *
     * fio.provider.register('netdisk', {
     *
     *     init: function(opt) {
     *         // init provider
     *     },
     *
     *     handle: function(request) {
     *         // handle request
     *     }
     *
     * });
     *
     */
    fio.provider.register = function(name, provider) {
        providerMap[name] = provider;
        if (!currentProvider) currentProvider = provider;

        // implement check
        if (typeof(provider.handle) != 'function') {
            throw new Error('Not implement: provider.handle()');
        }
    };


    /**
     * 切换 FIO 使用的默认 IO 提供方
     *
     * @method fio.provider.use
     *
     * @grammar fio.provider.use(name)
     *
     * @param  {string} name
     *     要使用的提供方的名称
     */
    fio.provider.use = function(name) {
        currentProvider = providerMap[name];
    };

    /**
     * 初始化指定的 IO 提供方
     *
     * @param  {string} name
     *     要初始化的提供方的名称
     *
     * @param  {object} opt
     *     初始化选项
     */
    fio.provider.init = function(name, opt) {
        var provider = providerMap[name];
        if (provider && typeof(provider.init) == 'function') {
            return provider.init.call(provider, opt);
        }
        return null;
    };

    /**
     * 实现 FIO 用户系统
     *
     * @method fio.user.impl
     *
     * @grammar fio.user.impl(impl)
     *
     * @param  {object} impl
     *     实现的代码，需要实现的方法包括：
     *
     *     impl.init(opt): null
     *         用户系统需要初始化的入口
     *
     *     impl.check(): fio.user.User
     *         返回当前用户
     *
     *     impl.login(): Promise<fio.user.User>
     *         进行用户的登陆
     *
     *     impl.logout(): Promise<fio.user.User>
     *         登出当前用户
     *
     *     impl.current(): fio.user.User
     *         返回当前用户（如果已登录）
     *
     */
    fio.user.impl = function(impl) {
        userImpl = impl;
    };

    ['check', 'login', 'logout', 'init', 'current'].forEach(function(operation) {
        fio.user[operation] = function() {
            return userImpl[operation].apply(userImpl, arguments);
        };
    });

    /**
     * 读取文件
     *
     * @method fio.file.read
     *
     * @grammar fio.file.read(opt)
     *
     * @param {object} opt 选项
     *
     *     opt.path {string}
     *         读取的文件的路径
     *
     * @return {Promise<fio.file.File>} 读取的文件
     *
     * @example
     *
     * ```js
     * fio.file.read({
     *     path: 'a.txt'
     * }).then(function(file) {
     *     console.log(file.data.content);
     * }).catch(function(e) {
     *     console.log(e.message);
     * });
     * ```
     */

    /**
     * 写入文件
     *
     * @method fio.file.write
     *
     * @grammar fio.file.write(opt)
     *
     * @param  {object} opt 选项
     *
     *     opt.path {string}
     *         要写入文件的位置
     *
     *     opt.content {string|object|blob}
     *         要写入的文件的内容
     *
     *     opt.ondup {Enum}
     *         存在同名文件时采取的策略
     *
     * @return {Promise<fio.file.File>} 返回已写入的文件
     *
     * @example
     *
     * ```js
     * fio.file.write({
     *     path: 'hello.txt',
     *     content: 'hello, fio!'
     * }).then(function(file) {
     *     console.log('the file size is ' + file.size);
     * }).catch(function(e) {
     *     console.log(e);
     * });
     * ```
     */

    /**
     * 列出指定目录的文件
     *
     * @method fio.file.list
     *
     * @grammar fio.file.list(opt)
     *
     * @param  {object} opt 选项
     *     opt.path {string} 要列出文件的路径
     *
     * @return {Promise<fio.file.File[]>} 列出的文件列表
     *
     * @example
     *
     * ```js
     * fio.file.list({
     *     path: '/kityminder/'
     * }).then(function(files) {
     *     console.table(files);
     * });
     * ``
     */

    /**
     * 移动指定的文件
     *
     * @method fio.file.move
     *
     * @grammar fio.file.move(opt)
     *
     * @param  {object} opt 选项
     *     opt.path {string} 要移动的文件或目录的路径
     *     opt.newPath {string} 目标位置
     *
     * @return {Promise<fio.file.File>}
     *
     * @example
     *
     * ```js
     * fio.file.move({
     *     path: '/kityminder/a.xmind',
     *     newPath: '/kityminder/b.xmind'
     * }).then(function(file) {
     *     console.log('file moved to' + file.path);
     * });
     * ``
     */


    /**
     * 删除文件
     *
     * @method fio.file.delete
     *
     * @grammar fio.file.delete(opt)
     *
     * @param {object} opt 选项
     *
     *     opt.path {string}
     *         要删除的文件的路径
     *
     * @return {Promise<fio.file.File>} 读取的文件
     *
     * @example
     *
     * ```js
     * fio.file.delete({
     *     path: 'a.txt'
     * }).then(function(file) {
     *     console.log('file deleted: ' + file.path);
     * }).catch(function(e) {
     *     console.log(e.message);
     * });
     * ```
     */


    /**
     * 创建目录
     *
     * @method fio.file.mkdir
     *
     * @grammar fio.file.mkdir(opt)
     *
     * @param {object} opt 选项
     *
     *     opt.path {string}
     *         要创建的目录的路径
     *
     * @return {Promise<fio.file.File>} 已创建的目录
     *
     * @example
     *
     * ```js
     * fio.file.mkdir({
     *     path: '/kityminder/a'
     * }).then(function(file) {
     *     console.log('dir created: ' + file.path);
     * }).catch(function(e) {
     *     console.log(e.message);
     * });
     * ```
     */


    /**
     * 读取指定路径的 ACL
     *
     * @method fio.file.readAcl
     *
     * @grammar fio.file.readAcl(opt)
     *
     * @param {object} opt 选项
     *
     *     opt.path {string}
     *         要读取 ACL 的路径
     *
     * @return {Promise<fio.file.Acl[]>} 读取的 ACL 集合
     *
     * @example
     *
     * ```js
     * fio.file.readAcl({
     *     path: 'a.txt'
     * }).then(function(acl) {
     *     console.table(acl);
     * }).catch(function(e) {
     *     console.log(e.message);
     * });
     * ```
     */


    /**
     * 写入指定路径的 ACL
     *
     * @method fio.file.writeAcl
     *
     * @grammar fio.file.write(opt)
     *
     * @param {object} opt 选项
     *
     *     opt.path {string}
     *         要写入 ACL 的路径
     *     option.acl {object}
     *         要写入的 ACL（username => access）
     *
     * @return {Promise<fio.file.Acl[]>} 写入后 ACL 后，指定路径的 ACL 集合
     *
     * @example
     *
     * ```js
     * fio.file.writeAcl({
     *     path: 'a.txt',
     *     acl: {
     *         techird: fio.file.ACCESS_READ | fio.file.ACCESS_WRITE
     *     }
     * }).then(function(acl) {
     *     console.table(acl);
     * }).catch(function(e) {
     *     console.log(e.message);
     * });
     * ```
     */
    ['read', 'write', 'list', 'move', 'delete', 'mkdir', 'readAcl', 'writeAcl'].forEach(function(operation) {

        fio.file[operation] = function(opt) {
            return fio.user.check().then(function(user) {

                var provider = opt.provider ? providerMap[opt.provider] : currentProvider;
                var request = new FileRequest(opt.path, operation, user);

                if (operation == 'read') {
                    request.dataType = opt.dataType || fio.file.TYPE_TEXT;
                }

                if (operation == 'write') {
                    request.dupPolicy = opt.ondup;
                    request.data = new fio.file.Data(opt.content);
                    delete opt.ondup;
                }

                if (operation == 'move') {
                    request.newPath = opt.newPath;
                    delete opt.newPath;
                }

                if (operation == 'writeAcl') {
                    request.acl = opt.acl;
                    delete opt.acl;
                }

                delete opt.provider;
                delete opt.path;

                request.extra = opt;

                var response = provider.handle(request);
                // 确保返回的是一个 Promise 对象
                return Promise.resolve(response);
            });
        };
    });

    // export
    window.fio = fio;
})(Promise);