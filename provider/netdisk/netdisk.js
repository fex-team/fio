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
 *     2. 设置登录回调地址为使用的页面，设置位置：其他API -> 安全设置
 *     3. 申请 PCS API 权限
 *
 */

/* TODO: 脱离 jQuery 依赖 */
(function(window, $) {

    /**
     * 用到的 URL 地址
     */
    var urls = {

        /**
         * PCS API 接口
         *
         * @see http://developer.baidu.com/wiki/index.php?title=docs/pcs/rest/file_data_apis_list
         */
        'file': 'https://pcs.baidu.com/rest/2.0/pcs/file'
    };

    /**
     * 网络请求
     */
    function ajax(opt) {
        opt.cache = false;
        return new Promise(function(resolve, reject) {
            $.ajax(opt).done(resolve).fail(reject);
        });
    }

    /**
     * 延时执行
     */
    function wait(delay) {
        return new Promise(function(resolve) {
            setTimeout(function() {
                resolve();
            }, delay);
        });
    }

    // 转换 PCS 的文件数据为 fio.file.File
    function pcs2file(pcs_file) {
        var file = new fio.file.File(pcs_file.path);
        file.createTime = new Date(pcs_file.ctime * 1000);
        file.modifyTime = new Date(pcs_file.mtime * 1000);
        file.size = pcs_file.size;
        file.isDir = !!pcs_file.isdir;
        file.provider = 'netdisk';
        return file;
    }

    function getMeta(path) {
        var user = fio.user.current();
        var access_token = user && user.access_token;

        if (!access_token) throw new Error('Not Authorized');

        function request() {
            return ajax({
                url: urls.file,
                data: {
                    method: 'meta',
                    access_token: access_token,
                    path: path
                },
                dataType: 'json'
            })['catch'](function(e) {
                if (request.retry++ > 2) throw e;
                return new Promise(function(resolve) {
                    setTimeout(function() {
                        resolve(request());
                    }, 200 * request.retry);
                });
            });
        }

        request.retry = 0;

        return request();
    }

    // 根据文件请求分发处理
    function handle(request) {
        var user = fio.user.current();
        var access_token = user && user.access_token;

        if (!access_token) throw new Error('Not Authorized');

        var param = {};

        // 默认参数
        var opt = {
            url: urls.file,
            type: 'GET',
            dataType: 'JSON'
        };

        // 处理其他参数
        switch (request.method) {

            case fio.file.METHOD_ACL_READ:
            case fio.file.METHOD_ACL_WRITE:
                throw new Error('Not Supported File Request:' + request.method);

            case fio.file.METHOD_READ:
                opt.dataType = request.dataType;
                param.method = 'download';
                break;

            case fio.file.METHOD_WRITE:
                opt.type = 'POST';

                param.method = 'upload';
                param.ondup = request.dupPolicy == fio.file.DUP_OVERWRITE ? 'overwrite' : 'newcopy';

                var form = new FormData();
                if (request.data.type == fio.file.TYPE_BLOB) {
                    form.append('file', request.data.content);
                } else {
                    form.append('file', new Blob([request.data.content], {
                        type: 'text/plain'
                    }));
                }
                opt.data = form;
                opt.processData = false;
                opt.contentType = false;

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
                if (request.dupPolicy == fio.file.DUP_RENAME) {
                    param.ondup = 'newcopy';
                }
                break;

            case fio.file.METHOD_DELETE:
                opt.type = 'POST';
                param.method = 'delete';
                break;
        }

        // 处理 path 参数
        if (request.method == fio.file.METHOD_MOVE) {
            param.from = request.path;
        } else {
            param.path = request.path;
        }

        // 参数拼接到 URL 中
        opt.url += '?' + $.param(param) + '&access_token=' + access_token;

        // 重试次数
        var retry = request.extra.retry === undefined ? 3 : parseInt(request.extra.retry, 10);
        var failed = 0;

        function tryRequest() {

            // 捕捉到错误后重试或抛异常
            function retryOrThrow(e) {
                window.console.warn('PCS Fail(' + (++failed) + '): ', {
                    request: request,
                    error: e
                });
                if (retry--) {
                    return wait(1000 * failed).then(tryRequest);
                } else {
                    e.requestMethod = request.method;
                    e.requestPath = request.path;
                    e.requestUser = request.user && request.user.username || null;
                    e.requestParam = param;
                    if (request.dataType)
                        e.requestDataType = request.dataType;
                    throw e;
                }
            }

            function success(response) {

                function meta2pcs(meta) {
                    return meta.list[0];
                }

                // 调用失败
                if (response.error_code) {
                    throw new fio.FileRequestError(response);
                }

                // 读取操作需要抓取文件元数据后返回
                if (request.method === fio.file.METHOD_READ) {

                    return getMeta(param.path).then(meta2pcs).then(pcs2file).then(function(file) {
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
                    return new Promise(function(resolve) {
                        setTimeout(function() {
                            resolve(getMeta(response.extra.list[0].to).then(meta2pcs).then(pcs2file));
                        }, 200);
                    });
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
            }

            function fail($xhr) {
                var response = $xhr.responseText;

                var responseInfo = {
                    readyState: $xhr.readyState,
                    status: $xhr.status,
                    statusText: $xhr.statusText,
                    headers: $xhr.getAllResponseHeaders(),
                    responseText: response
                };

                if (response) try {
                    responseInfo.detail = JSON.parse(response);
                } catch (ignore) {}

                return retryOrThrow(new fio.FileRequestError(responseInfo));
            }

            return ajax(opt).then(success, fail);
        }

        return tryRequest();
    }


    // 网盘 IO 提供实现
    fio.provider.register('netdisk', {
        handle: handle
    });
})(window, jQuery);