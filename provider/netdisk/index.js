/* global $:true, fio: true */

$(function() {

    var base = '/apps/kityminder';
    var pwd = base + '/';

    // 初始化网盘提供方
    fio.provider.init('netdisk', {
        apiKey: 'wiE55BGOG8BkGnpPs6UNtPbb'
    });

    $('#login-btn, #switch-btn').click(function() {
        fio.user.login({
            remember: 7 * 24 * 60 * 60,
            force: this.id == 'switch-btn'
        });
    });

    $('#logout-btn').click(function() {
        fio.user.logout();
        $('#user').removeClass('logined');
    });

    // 检查登录状态
    fio.user.check().then(function(user) {
        if (user) {
            $('#user').addClass('logined');
            $('#user-head').attr('src', user.smallImage);
            $('#user-name').text(user.username);
            ls();
        }
    });

    $('body').delegate('.file', 'click', function(e) {
        var file = $(this).data('file');
        if (file.isDir) {
            pwd = file.path;
            return ls();
        } else {
            $('#content div.info').html('loading...');
            fio.file.read({
                path: file.path,
                dataType: file.extension == '.km' ? fio.file.TYPE_TEXT : fio.file.TYPE_BLOB
            }).then(function(file) {
                $('#content div.info').html(file.data.content);
            });
        }
        $('.file.active').removeClass('active');
        $(this).addClass('active');
    });

    $('body').delegate('.dir', 'click', function(e) {
        pwd = $(this).data('path');
        return ls();
    });

    function show(files) {
        var $section;

        $section = $('<ul class="section"></ul>').hide().appendTo('#content .finder').delay(100).fadeIn(300);

        $section.append(files.map(function(file) {
            return $('<li>' + file.filename + '</li>').addClass('file').data('file', file);
        }));

        var parts = pwd.substr(base.length).split('/');
        var path = base;
        var $path = $('#path').empty();
        parts.forEach(function(part) {
            if (part !== '') {
                path += '/' + part;
            }
            $('<a></a>')
                .text(part + '/')
                .data('path', path)
                .addClass('dir')
                .appendTo($path);
        });
        $('<a>+</a>').addClass('add-file').appendTo($path);
    }

    function ls() {
        var $section = $('#content .finder .section');

        $section.animate({
            left: -250
        }, 200, function() {
            $(this).remove();
        });
        fio.file.list({
            path: pwd
        }).then(show).catch(function(e) {
            $('#content div.info').html(e.message);
        });
    }
});