/**
 * @fileOverview
 *
 * 为 FIO 提供百度第三方平台用户系统
 *
 * @author: techird
 * @copyright: Baidu FEX, 2014
 */

/* global fio: true, jQuery: true */
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
        'current': window.location.href
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
        apiKey = opt.apiKey || apiKey;
    }

    /**
     * 网络请求
     */
    function ajax(opt) {
        return new Promise(function(resolve, reject) {
            $.ajax(opt).done(resolve).fail(reject);
        });
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
        var pattern = new RegExp(apiKey + '_ak=(.*?)(;|$)');
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
     * 返回当前用户
     *
     * @return {fio.user.User}
     */
    function current() {
        return user;
    }

    /**
     * 检查用户登录状态
     *
     * @return {Promise<fio.user.User>}
     */
    function check() {

        // 缓存检测
        if (user && +new Date() - user.validateTime < 60 * 60 * 1000) return Promise.resolve(user);

        if (check.pendingRequest) return check.pendingRequest;

        var fragment = urlFragment();

        // 登录回调；会在参数上有 AK
        if (fragment.access_token) {

            // 把 AK 保存在 Cookie 里
            writeAK(fragment.access_token, fragment.state);

            // 清掉登录回调参数
            document.location.href = urls.current.substr(0, document.location.href.indexOf('#'));

            return (check.pendingRequest = new Promise(function() {}));

        }

        // 非登录回调，读取 AK
        else {

            // 尝试从 Cookie 读取 AK
            access_token = readAK();

            // 读取失败返回
            if (!access_token) return Promise.resolve(null);
        }

        function getUserInfo() {
            return new Promise(function(resolve, reject) {
                // 超时重试
                var resolved = false;
                var timeouts = [1000, 2000, 3000];
                var timer = 0;

                function request() {
                    clearTimeout(timer);
                    if (!resolved && timeouts.length) {
                        timer = setTimeout(request, timeouts.shift());
                    }
                    return ajax({
                        url: urls.getLoggedInUser,
                        data: {
                            access_token: access_token
                        },
                        dataType: 'jsonp'
                    }).then(function(ret) {
                        clearTimeout(timer);
                        if (!resolved) resolve(ret);
                        resolved = true;
                    });
                }
                request();
            });
        }

        // 使用 AK 获得用户信息
        return check.pendingRequest = getUserInfo().then(function(ret) {

            // 授权错误，可能是 AK 过时了
            if (ret.error_code) {
                access_token = null;
                clearAK();
                return null;
            }

            user = new fio.user.User(ret.uid, ret.uname);

            user.smallImage = 'http://tb.himg.baidu.com/sys/portraitn/item/' + ret.portrait;
            user.largeImage = 'http://tb.himg.baidu.com/sys/portrait/item/' + ret.portrait;
            user.access_token = access_token;
            user.validateTime = +new Date();

            check.pendingRequest = null;

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
            'scope=basic netdisk',
            'redirect_uri=' + (opt.redirectUrl || urls.current), // 调回到当前页面，check 的时候就能捕获 AK
            'display=page',
            'force_login=' + (opt && opt.force ? 1 : 0),
            'state=' + (opt.remember || 60) // remember second
        ].join('&');
        return new Promise(function() {}); // never fullfilled
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
        return Promise.resolve(logouted);
    }

    // 用户系统实现
    fio.user.impl({
        check: check,
        login: login,
        logout: logout,
        init: init,
        current: current
    });

})(window, jQuery);