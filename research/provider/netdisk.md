网盘 IO 提供方案
==============

## 用户系统

百度网盘提供了一套 [Open API](http://wiki.babel.baidu.com/twiki/bin/view/Com/Main/PCS_INNER_API) 来提供网盘文件的访问的能力。在使用这个 API 之前，需要先使用百度开放平台 [OAuth](http://developer.baidu.com/wiki/index.php?title=docs/oauth) 的授权。

授权是为了获取 `access_token`，它同时代表应用和用户的身份，而且只在一定时间内有效。使用 `access_token`，可以调用在开放平台上注册的 API（via HTTPS）。

## 网盘接口

目前[PCS 文档上提供的 API](http://wiki.babel.baidu.com/twiki/bin/view/Com/Main/PCS_INNER_API)，我们需要使用的可能包括：

- upload
- download
- mkdir
- meta
- list
- move
- delete
- getref
- copy
- create share
- list share
- cancel share
- unzip

这些接口 PCS 提供了 PHP 版本的 SDK。

## 网盘 IO 提供的功能

简单的扫描了一下这些接口，认为已经可以做的功能包括：

1. 文件读取
2. 文件写入
3. 文件移动
4. 目录创建
5. 文件删除
6. 公开分享

这些接口不足够完成的功能：

1. 长效分享
2. 私密分享
3. 可写分享

需要调研网盘有没有访问其它用户文件的 API，最好是带用户自身 ACL 控制的。
