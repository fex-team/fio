/* global fio:true, jQuery: true */

/**
 *
 * @fileOverview
 *
 * 为 FIO 提供网盘 IO 支持
 *
 * @author techird
 *
 * 使用网盘的 IO，需要：
 *
 *     1. 在 http://dev.baidu.com 上创建应用。创建应用后，就有相应的 API Key
 *     2. 设置登录回调地址为使用的页面，设置位置：其他API->安全设置
 *     3. 申请 PCS API 权限
 *
 */

/* TODO: 脱离 jQuery 依赖 */
(function(window, $) {
    /**
     * 保存应用的 Api Key
     */
    var apiKey;

    /**
     * 登录后会有 access_token，验证后保存的当前用户
     *
     * 因为 API 中的 access_token 都是下划线命名法，所以这里不用骆驼，免得混淆
     */
    var access_token, user;

    /**
     * 用到的 URL 地址
     */
    var urls = {
        /**
         * Baidu OAuth 2.0 授权地址
         */
        'authorize': 'https://openapi.baidu.com/oauth/2.0/authorize',

        /**
         * 用户信息查询 API
         */
        'getLoggedInUser': 'https://openapi.baidu.com/rest/2.0/passport/users/getLoggedInUser',

        /**
         * 当前 URL
         */
        'current': window.location.href,

        /**
         * PCS API 接口
         *
         * @see http://developer.baidu.com/wiki/index.php?title=docs/pcs/rest/file_data_apis_list
         */
        'file': 'https://pcs.baidu.com/rest/2.0/pcs/file',
    };

    /**
     * 提供方的初始化方法
     *
     * @param  {object} opt 选项
     *
     *     opt.apiKey {string} 应用的 api key
     *
     */
    function init(opt) {
        apiKey = opt.apiKey;
    }

    /**
     * 网络请求
     */
    function ajax(opt) {
        return Promise.resolve($.ajax(opt));
    }

    /**
     * 解析 URL 上传递的参数
     * @return {object}
     */
    function urlFragment() {
        var url = urls.current;
        var pattern = /[&\?#](\w+?)=([^&]+)/g;
        var fragment = {};
        var match;

        while ((match = pattern.exec(url))) fragment[match[1]] = match[2];

        return fragment;
    }

    /**
     * 从 Cookie 中读取应用对应的 access_key
     */
    function readAK() {
        var cookie = document.cookie;
        var pattern = new RegExp(apiKey + '_ak=(.+?);');
        var match = pattern.exec(cookie);
        return match && decodeURIComponent(match[1]) || null;
    }

    /**
     * 写入 access_key 到 cookie
     */
    function writeAK(ak, remember) {
        var cookie = apiKey + '_ak=' + encodeURIComponent(ak);
        cookie += '; max-age=' + (remember || 60);
        document.cookie = cookie;
    }

    /**
     * 清空 cookie 中对应的 ak
     */
    function clearAK() {
        document.cookie = apiKey + '_ak=';
    }

    /**
     * 检查用户登录状态
     *
     * @return {Promise<fio.user.User>}
     */
    function check() {

        var fragment = urlFragment();

        // 登录回调；会在参数上有 AK
        if (fragment.access_token) {

            // 把 AK 保存在 Cookie 里
            writeAK(fragment.access_token, fragment.state);

            // 清掉登录回调参数
            document.location.href = urls.current.substr(0, document.location.href.indexOf('#'));

        }

        // 非登录回调，读取 AK
        else {

            // 尝试从 Cookie 读取 AK
            access_token = readAK();

            // 读取失败返回
            if (!access_token) return null;
        }

        // 使用 AK 获得用户信息
        return ajax({

            url: urls.getLoggedInUser,
            data: {
                access_token: access_token
            },
            dataType: 'jsonp'

        }).then(function(ret) {

            // 授权错误，可能是 AK 过时了
            if (ret.error) {
                access_token = null;
                clearAK();
                return null;
            }

            user = new fio.user.User(ret.uid, ret.uname);

            user.smallImage = 'http://tb.himg.baidu.com/sys/portraitn/item/' + ret.portrait;
            user.largeImage = 'http://tb.himg.baidu.com/sys/portrait/item/' + ret.portrait;
            user.access_token = access_token;

            return user;
        });
    }

    /**
     * 登录，直接跳到百度授权登录页面
     *
     * @param  {Object} opt 登录选项
     *
     *     opt.force {boolean}
     *         表示是否强制显示登录面板，而不是自动登录。默认为 false
     *
     *     opt.remember {int}
     *         表示是否记住用户登录状态，值表示记住的时间（秒）
     */
    function login(opt) {
        window.location.href = urls.authorize + '?' + [
            'client_id=' + apiKey,
            'response_type=token',
            'redirect_uri=' + urls.current, // 调回到当前页面，check 的时候就能捕获 AK
            'display=page',
            'force_login=' + (opt && opt.force ? 1 : 0),
            'state=' + opt.remember
        ].join('&');
    }

    /**
     * 注销
     * @return {[type]} [description]
     */
    function logout() {
        var logouted = user;
        user = null;
        access_token = null;
        clearAK();
        return logouted;
    }

    // 转换 PCS 的文件数据为 fio.file.File
    function pcs2file(pcs_file) {
        var file = new fio.file.File(pcs_file.path);
        file.createTime = new Date(pcs_file.ctime * 1000);
        file.modifyTime = new Date(pcs_file.mtime * 1000);
        file.size = pcs_file.size;
        file.isDir = !!pcs_file.isdir;
        return file;
    }

    function getMeta(path) {
        return ajax({
            url: urls.file,
            data: {
                method: 'meta',
                access_token: access_token,
                path: path
            },
            dataType: 'json'
        });
    }

    // 根据文件请求分发处理
    function handle(request) {
        if (!access_token) throw new Error('Not Authorized');

        var param = {
            access_token: access_token
        };

        var opt = {
            url: urls.file,
            type: 'GET',
            data: param,
            dataType: 'JSON'
        };

        // 处理 path 参数
        if (request.method != fio.file.METHOD_MOVE) {
            param.path = request.path;
        } else {
            param.from = request.path;
        }

        // 处理其他参数
        switch (request.method) {

            case fio.file.METHOD_ACL_READ:
            case fio.file.METHOD_ACL_WRITE:
                throw new Error('Not Supported File Request:' + request.method);

            case fio.file.METHOD_READ:
                opt.dataType = 'text';
                param.method = 'download';
                break;

            case fio.file.METHOD_WRITE:
                opt.type = 'POST';
                param.method = 'upload';
                param.file = request.data.content;
                param.ondup = request.dupPolicy == fio.file.DUP_OVERWRITE ? 'overwrite' : 'newcopy';
                break;

            case fio.file.METHOD_LIST:
                param.method = 'list';
                break;

            case fio.file.METHOD_MKDIR:
                opt.type = 'POST';
                param.method = 'mkdir';
                break;

            case fio.file.METHOD_MOVE:
                opt.type = 'POST';
                param.method = 'move';
                param.to = request.newPath;
                break;

            case fio.file.METHOD_DELETE:
                opt.type = 'POST';
                param.method = 'delete';
                break;
        }

        function throwError(response) {
            throw new Error([response.error_code, response.error_msg]);
        }

        return ajax(opt).then(function(response) {

            // 调用失败
            if (response.error_code) {
                throwError(response);
            }

            // 读取操作需要抓取文件元数据后返回
            if (request.method === fio.file.METHOD_READ) {

                return getMeta(param.path).then(function(meta) {
                    var file = pcs2file(meta.list[0]);
                    file.data = new fio.file.Data(response);
                    return file;
                });
            }

            // 列文件返回
            if (request.method == fio.file.METHOD_LIST) {
                return response.list.map(pcs2file);
            }

            // 移动文件返回
            if (request.method == fio.file.METHOD_MOVE) {
                return getMeta(response.to).then(pcs2file);
            }

            // 删除文件返回
            if (request.method == fio.file.METHOD_DELETE) {
                return new fio.file.File(request.path);
            }

            var file = pcs2file(response);

            // 写文件返回
            if (request.method === fio.file.METHOD_WRITE) {
                file.data = request.data;
            }

            return file;

        }, function(e) {
            console.log(e);
            if (e.responseText) throwError(JSON.parse(e.responseText));
            else throw e;
        });
    }

    // 用户系统实现
    fio.user.impl({
        check: check,
        login: login,
        logout: logout
    });

    // 网盘 IO 提供实现
    fio.provider.register('netdisk', {
        init: init,
        handle: handle
    });
})(window, jQuery);