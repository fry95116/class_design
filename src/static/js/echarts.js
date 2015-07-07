(function(_global){
var require, define;
(function () {
    var mods = {};

    define = function (id, deps, factory) {
        mods[id] = {
            id: id,
            deps: deps,
            factory: factory,
            defined: 0,
            exports: {},
            require: createRequire(id)
        };
    };

    require = createRequire('');

    function normalize(id, baseId) {
        if (!baseId) {
            return id;
        }

        if (id.indexOf('.') === 0) {
            var basePath = baseId.split('/');
            var namePath = id.split('/');
            var baseLen = basePath.length - 1;
            var nameLen = namePath.length;
            var cutBaseTerms = 0;
            var cutNameTerms = 0;

            pathLoop: for (var i = 0; i < nameLen; i++) {
                switch (namePath[i]) {
                    case '..':
                        if (cutBaseTerms < baseLen) {
                            cutBaseTerms++;
                            cutNameTerms++;
                        }
                        else {
                            break pathLoop;
                        }
                        break;
                    case '.':
                        cutNameTerms++;
                        break;
                    default:
                        break pathLoop;
                }
            }

            basePath.length = baseLen - cutBaseTerms;
            namePath = namePath.slice(cutNameTerms);

            return basePath.concat(namePath).join('/');
        }

        return id;
    }

    function createRequire(baseId) {
        var cacheMods = {};

        function localRequire(id, callback) {
            if (typeof id === 'string') {
                var exports = cacheMods[id];
                if (!exports) {
                    exports = getModExports(normalize(id, baseId));
                    cacheMods[id] = exports;
                }

                return exports;
            }
            else if (id instanceof Array) {
                callback = callback || function () {};
                callback.apply(this, getModsExports(id, callback, baseId));
            }
        };

        return localRequire;
    }

    function getModsExports(ids, factory, baseId) {
        var es = [];
        var mod = mods[baseId];

        for (var i = 0, l = Math.min(ids.length, factory.length); i < l; i++) {
            var id = normalize(ids[i], baseId);
            var arg;
            switch (id) {
                case 'require':
                    arg = (mod && mod.require) || require;
                    break;
                case 'exports':
                    arg = mod.exports;
                    break;
                case 'module':
                    arg = mod;
                    break;
                default:
                    arg = getModExports(id);
            }
            es.push(arg);
        }

        return es;
    }

    function getModExports(id) {
        var mod = mods[id];
        if (!mod) {
            throw new Error('No ' + id);
        }

        if (!mod.defined) {
            var factory = mod.factory;
            var factoryReturn = factory.apply(
                this,
                getModsExports(mod.deps || [], factory, id)
            );
            if (typeof factoryReturn !== 'undefined') {
                mod.exports = factoryReturn;
            }
            mod.defined = 1;
        }

        return mod.exports;
    }
}());
define('echarts/echarts', ['require', './config', 'zrender/tool/util', 'zrender/tool/event', 'zrender/tool/env', 'zrender', 'zrender/config', './chart/island', './component/toolbox', './component', './component/title', './component/tooltip', './component/legend', './util/ecData', './chart', 'zrender/tool/color', './component/timeline', 'zrender/shape/Image', 'zrender/loadingEffect/Bar', 'zrender/loadingEffect/Bubble', 'zrender/loadingEffect/DynamicLine', 'zrender/loadingEffect/Ring', 'zrender/loadingEffect/Spin', 'zrender/loadingEffect/Whirling', './theme/macarons', './theme/infographic'], function (require) {
    var ecConfig = require('./config');
    var zrUtil = require('zrender/tool/util');
    var zrEvent = require('zrender/tool/event');

    var self = {};

    var _canvasSupported = require('zrender/tool/env').canvasSupported;
    var _idBase = new Date() - 0;
    var _instances = {};    // ECharts实例map索引
    var DOM_ATTRIBUTE_KEY = '_echarts_instance_';

    self.version = '2.2.5';
    self.dependencies = {
        zrender: '2.1.0'
    };
    /**
     * 入口方法
     */
    self.init = function (dom, theme) {
        var zrender = require('zrender');
        if ((zrender.version.replace('.', '') - 0) < (self.dependencies.zrender.replace('.', '') - 0)) {
            console.error(
                'ZRender ' + zrender.version
                + ' is too old for ECharts ' + self.version
                + '. Current version need ZRender '
                + self.dependencies.zrender + '+'
            );
        }

        dom = dom instanceof Array ? dom[0] : dom;

        // dom与echarts实例映射索引
        var key = dom.getAttribute(DOM_ATTRIBUTE_KEY);
        if (!key) {
            key = _idBase++;
            dom.setAttribute(DOM_ATTRIBUTE_KEY, key);
        }

        if (_instances[key]) {
            // 同一个dom上多次init，自动释放已有实例
            _instances[key].dispose();
        }
        _instances[key] = new Echarts(dom);
        _instances[key].id = key;
        _instances[key].canvasSupported = _canvasSupported;
        _instances[key].setTheme(theme);

        return _instances[key];
    };

    /**
     * 通过id获得ECharts实例，id可在实例化后读取
     */
    self.getInstanceById = function (key) {
        return _instances[key];
    };

    /**
     * 消息中心
     */
    function MessageCenter() {
        zrEvent.Dispatcher.call(this);
    }
    zrUtil.merge(MessageCenter.prototype, zrEvent.Dispatcher.prototype, true);

    /**
     * 基于zrender实现Echarts接口层
     * @param {HtmlElement} dom 必要
     */
    function Echarts(dom) {
        // Fxxk IE11 for breaking initialization without a warrant;
        // Just set something to let it be!
        // by kener 2015-01-09
        dom.innerHTML = '';
        this._themeConfig = {}; // zrUtil.clone(ecConfig);

        this.dom = dom;
        // this._zr;
        // this._option;                    // curOption clone
        // this._optionRestore;             // for restore;
        // this._island;
        // this._toolbox;
        // this._timeline;
        // this._refreshInside;             // 内部刷新标志位

        this._connected = false;
        this._status = {                    // 用于图表间通信
            dragIn: false,
            dragOut: false,
            needRefresh: false
        };
        this._curEventType = false;         // 破循环信号灯
        this._chartList = [];               // 图表实例

        this._messageCenter = new MessageCenter();

        this._messageCenterOutSide = new MessageCenter();    // Echarts层的外部消息中心，做Echarts层的消息转发

        // resize方法经常被绑定到window.resize上，闭包一个this
        this.resize = this.resize();

        // 初始化::构造函数
        this._init();
    }

    /**
     * ZRender EVENT
     *
     * @inner
     * @const
     * @type {Object}
     */
    var ZR_EVENT = require('zrender/config').EVENT;

    /**
     * 要绑定监听的zrender事件列表
     *
     * @const
     * @inner
     * @type {Array}
     */
    var ZR_EVENT_LISTENS = [
        'CLICK', 'DBLCLICK', 'MOUSEOVER', 'MOUSEOUT',
        'DRAGSTART', 'DRAGEND', 'DRAGENTER', 'DRAGOVER', 'DRAGLEAVE', 'DROP'
    ];

    /**
     * 对echarts的实例中的chartList属性成员，逐个进行方法调用，遍历顺序为逆序
     * 由于在事件触发的默认行为处理中，多次用到相同逻辑，所以抽象了该方法
     * 由于所有的调用场景里，最多只有两个参数，基于性能和体积考虑，这里就不使用call或者apply了
     *
     * @inner
     * @param {ECharts} ecInstance ECharts实例
     * @param {string} methodName 要调用的方法名
     * @param {*} arg0 调用参数1
     * @param {*} arg1 调用参数2
     * @param {*} arg2 调用参数3
     */
    function callChartListMethodReverse(ecInstance, methodName, arg0, arg1, arg2) {
        var chartList = ecInstance._chartList;
        var len = chartList.length;

        while (len--) {
            var chart = chartList[len];
            if (typeof chart[methodName] === 'function') {
                chart[methodName](arg0, arg1, arg2);
            }
        }
    }

    Echarts.prototype = {
        /**
         * 初始化::构造函数
         */
        _init: function () {
            var self = this;
            var _zr = require('zrender').init(this.dom);
            this._zr = _zr;

            // wrap: n,e,d,t for name event data this
            this._messageCenter.dispatch = function(type, event, eventPackage, that) {
                eventPackage = eventPackage || {};
                eventPackage.type = type;
                eventPackage.event = event;

                self._messageCenter.dispatchWithContext(type, eventPackage, that);
                self._messageCenterOutSide.dispatchWithContext(type, eventPackage, that);

                // 如下注掉的代码，@see: https://github.com/ecomfe/echarts-discuss/issues/3
                // if (type != 'HOVER' && type != 'MOUSEOUT') {    // 频繁事件直接抛出
                //     setTimeout(function(){
                //         self._messageCenterOutSide.dispatchWithContext(
                //             type, eventPackage, that
                //         );
                //     },50);
                // }
                // else {
                //     self._messageCenterOutSide.dispatchWithContext(
                //         type, eventPackage, that
                //     );
                // }
            };

            this._onevent = function(param){
                return self.__onevent(param);
            };
            for (var e in ecConfig.EVENT) {
                if (e != 'CLICK' && e != 'DBLCLICK'
                    && e != 'HOVER' && e != 'MOUSEOUT' && e != 'MAP_ROAM'
                ) {
                    this._messageCenter.bind(ecConfig.EVENT[e], this._onevent, this);
                }
            }


            var eventBehaviors = {};
            this._onzrevent = function (param) {
                return self[eventBehaviors[ param.type ]](param);
            };

            // 挂载关心的事件
            for (var i = 0, len = ZR_EVENT_LISTENS.length; i < len; i++) {
                var eventName = ZR_EVENT_LISTENS[i];
                var eventValue = ZR_EVENT[eventName];
                eventBehaviors[eventValue] = '_on' + eventName.toLowerCase();
                _zr.on(eventValue, this._onzrevent);
            }

            this.chart = {};            // 图表索引
            this.component = {};        // 组件索引

            // 内置图表
            // 孤岛
            var Island = require('./chart/island');
            this._island = new Island(this._themeConfig, this._messageCenter, _zr, {}, this);
            this.chart.island = this._island;

            // 内置通用组件
            // 工具箱
            var Toolbox = require('./component/toolbox');
            this._toolbox = new Toolbox(this._themeConfig, this._messageCenter, _zr, {}, this);
            this.component.toolbox = this._toolbox;

            var componentLibrary = require('./component');
            componentLibrary.define('title', require('./component/title'));
            componentLibrary.define('tooltip', require('./component/tooltip'));
            componentLibrary.define('legend', require('./component/legend'));

            if (_zr.getWidth() === 0 || _zr.getHeight() === 0) {
                console.error('Dom’s width & height should be ready before init.');
            }
        },

        /**
         * ECharts事件处理中心
         */
        __onevent: function (param){
            param.__echartsId = param.__echartsId || this.id;

            // 来自其他联动图表的事件
            var fromMyself = (param.__echartsId === this.id);

            if (!this._curEventType) {
                this._curEventType = param.type;
            }

            switch (param.type) {
                case ecConfig.EVENT.LEGEND_SELECTED :
                    this._onlegendSelected(param);
                    break;
                case ecConfig.EVENT.DATA_ZOOM :
                    if (!fromMyself) {
                        var dz = this.component.dataZoom;
                        if (dz) {
                            dz.silence(true);
                            dz.absoluteZoom(param.zoom);
                            dz.silence(false);
                        }
                    }
                    this._ondataZoom(param);
                    break;
                case ecConfig.EVENT.DATA_RANGE :
                    fromMyself && this._ondataRange(param);
                    break;
                case ecConfig.EVENT.MAGIC_TYPE_CHANGED :
                    if (!fromMyself) {
                        var tb = this.component.toolbox;
                        if (tb) {
                            tb.silence(true);
                            tb.setMagicType(param.magicType);
                            tb.silence(false);
                        }
                    }
                    this._onmagicTypeChanged(param);
                    break;
                case ecConfig.EVENT.DATA_VIEW_CHANGED :
                    fromMyself && this._ondataViewChanged(param);
                    break;
                case ecConfig.EVENT.TOOLTIP_HOVER :
                    fromMyself && this._tooltipHover(param);
                    break;
                case ecConfig.EVENT.RESTORE :
                    this._onrestore();
                    break;
                case ecConfig.EVENT.REFRESH :
                    fromMyself && this._onrefresh(param);
                    break;
                // 鼠标同步
                case ecConfig.EVENT.TOOLTIP_IN_GRID :
                case ecConfig.EVENT.TOOLTIP_OUT_GRID :
                    if (!fromMyself) {
                        // 只处理来自外部的鼠标同步
                        var grid = this.component.grid;
                        if (grid) {
                            this._zr.trigger(
                                'mousemove',
                                {
                                    connectTrigger: true,
                                    zrenderX: grid.getX() + param.x * grid.getWidth(),
                                    zrenderY: grid.getY() + param.y * grid.getHeight()
                                }
                            );
                        }
                    }
                    else if (this._connected) {
                        // 来自自己，并且存在多图联动，空间坐标映射修改参数分发
                        var grid = this.component.grid;
                        if (grid) {
                            param.x = (param.event.zrenderX - grid.getX()) / grid.getWidth();
                            param.y = (param.event.zrenderY - grid.getY()) / grid.getHeight();
                        }
                    }
                    break;
                /*
                case ecConfig.EVENT.RESIZE :
                case ecConfig.EVENT.DATA_CHANGED :
                case ecConfig.EVENT.PIE_SELECTED :
                case ecConfig.EVENT.MAP_SELECTED :
                    break;
                */
            }

            // 多图联动，只做自己的一级事件分发，避免级联事件循环
            if (this._connected && fromMyself && this._curEventType === param.type) {
                for (var c in this._connected) {
                    this._connected[c].connectedEventHandler(param);
                }
                // 分发完毕后复位
                this._curEventType = null;
            }

            if (!fromMyself || (!this._connected && fromMyself)) {  // 处理了完联动事件复位
                this._curEventType = null;
            }
        },

        /**
         * 点击事件，响应zrender事件，包装后分发到Echarts层
         */
        _onclick: function (param) {
            callChartListMethodReverse(this, 'onclick', param);

            if (param.target) {
                var ecData = this._eventPackage(param.target);
                if (ecData && ecData.seriesIndex != null) {
                    this._messageCenter.dispatch(
                        ecConfig.EVENT.CLICK,
                        param.event,
                        ecData,
                        this
                    );
                }
            }
        },

        /**
         * 双击事件，响应zrender事件，包装后分发到Echarts层
         */
        _ondblclick: function (param) {
            callChartListMethodReverse(this, 'ondblclick', param);

            if (param.target) {
                var ecData = this._eventPackage(param.target);
                if (ecData && ecData.seriesIndex != null) {
                    this._messageCenter.dispatch(
                        ecConfig.EVENT.DBLCLICK,
                        param.event,
                        ecData,
                        this
                    );
                }
            }
        },

        /**
         * 鼠标移入事件，响应zrender事件，包装后分发到Echarts层
         */
        _onmouseover: function (param) {
            if (param.target) {
                var ecData = this._eventPackage(param.target);
                if (ecData && ecData.seriesIndex != null) {
                    this._messageCenter.dispatch(
                        ecConfig.EVENT.HOVER,
                        param.event,
                        ecData,
                        this
                    );
                }
            }
        },

        /**
         * 鼠标移出事件，响应zrender事件，包装后分发到Echarts层
         */
        _onmouseout: function (param) {
            if (param.target) {
                var ecData = this._eventPackage(param.target);
                if (ecData && ecData.seriesIndex != null) {
                    this._messageCenter.dispatch(
                        ecConfig.EVENT.MOUSEOUT,
                        param.event,
                        ecData,
                        this
                    );
                }
            }
        },

        /**
         * dragstart回调，可计算特性实现
         */
        _ondragstart: function (param) {
            // 复位用于图表间通信拖拽标识
            this._status = {
                dragIn: false,
                dragOut: false,
                needRefresh: false
            };

            callChartListMethodReverse(this, 'ondragstart', param);
        },

        /**
         * dragging回调，可计算特性实现
         */
        _ondragenter: function (param) {
            callChartListMethodReverse(this, 'ondragenter', param);
        },

        /**
         * dragstart回调，可计算特性实现
         */
        _ondragover: function (param) {
            callChartListMethodReverse(this, 'ondragover', param);
        },

        /**
         * dragstart回调，可计算特性实现
         */
        _ondragleave: function (param) {
            callChartListMethodReverse(this, 'ondragleave', param);
        },

        /**
         * dragstart回调，可计算特性实现
         */
        _ondrop: function (param) {
            callChartListMethodReverse(this, 'ondrop', param, this._status);
            this._island.ondrop(param, this._status);
        },

        /**
         * dragdone回调 ，可计算特性实现
         */
        _ondragend: function (param) {
            callChartListMethodReverse(this, 'ondragend', param, this._status);

            this._timeline && this._timeline.ondragend(param, this._status);
            this._island.ondragend(param, this._status);

            // 发生过重计算
            if (this._status.needRefresh) {
                this._syncBackupData(this._option);

                var messageCenter = this._messageCenter;
                messageCenter.dispatch(
                    ecConfig.EVENT.DATA_CHANGED,
                    param.event,
                    this._eventPackage(param.target),
                    this
                );
                messageCenter.dispatch(ecConfig.EVENT.REFRESH, null, null, this);
            }
        },

        /**
         * 图例选择响应
         */
        _onlegendSelected: function (param) {
            // 用于图表间通信
            this._status.needRefresh = false;
            callChartListMethodReverse(this, 'onlegendSelected', param, this._status);

            if (this._status.needRefresh) {
                this._messageCenter.dispatch(ecConfig.EVENT.REFRESH, null, null, this);
            }
        },

        /**
         * 数据区域缩放响应
         */
        _ondataZoom: function (param) {
            // 用于图表间通信
            this._status.needRefresh = false;
            callChartListMethodReverse(this, 'ondataZoom', param, this._status);

            if (this._status.needRefresh) {
                this._messageCenter.dispatch(ecConfig.EVENT.REFRESH, null, null, this);
            }
        },

        /**
         * 值域漫游响应
         */
        _ondataRange: function (param) {
            this._clearEffect();
            // 用于图表间通信
            this._status.needRefresh = false;
            callChartListMethodReverse(this, 'ondataRange', param, this._status);

            // 没有相互影响，直接刷新即可
            if (this._status.needRefresh) {
                this._zr.refreshNextFrame();
            }
        },

        /**
         * 动态类型切换响应
         */
        _onmagicTypeChanged: function () {
            this._clearEffect();
            this._render(this._toolbox.getMagicOption());
        },

        /**
         * 数据视图修改响应
         */
        _ondataViewChanged: function (param) {
            this._syncBackupData(param.option);
            this._messageCenter.dispatch(
                ecConfig.EVENT.DATA_CHANGED,
                null,
                param,
                this
            );
            this._messageCenter.dispatch(ecConfig.EVENT.REFRESH, null, null, this);
        },

        /**
         * tooltip与图表间通信
         */
        _tooltipHover: function (param) {
            var tipShape = [];
            callChartListMethodReverse(this, 'ontooltipHover', param, tipShape);
        },

        /**
         * 还原
         */
        _onrestore: function () {
            this.restore();
        },

        /**
         * 刷新
         */
        _onrefresh: function (param) {
            this._refreshInside = true;
            this.refresh(param);
            this._refreshInside = false;
        },

        /**
         * 数据修改后的反向同步dataZoom持有的备份数据
         */
        _syncBackupData: function (curOption) {
            this.component.dataZoom && this.component.dataZoom.syncBackupData(curOption);
        },

        /**
         * 打包Echarts层的事件附件
         */
        _eventPackage: function (target) {
            if (target) {
                var ecData = require('./util/ecData');

                var seriesIndex = ecData.get(target, 'seriesIndex');
                var dataIndex = ecData.get(target, 'dataIndex');

                dataIndex = seriesIndex != -1 && this.component.dataZoom
                            ? this.component.dataZoom.getRealDataIndex(
                                seriesIndex,
                                dataIndex
                              )
                            : dataIndex;
                return {
                    seriesIndex: seriesIndex,
                    seriesName: (ecData.get(target, 'series') || {}).name,
                    dataIndex: dataIndex,
                    data: ecData.get(target, 'data'),
                    name: ecData.get(target, 'name'),
                    value: ecData.get(target, 'value'),
                    special: ecData.get(target, 'special')
                };
            }
            return;
        },

        _noDataCheck: function(magicOption) {
            var series = magicOption.series;

            for (var i = 0, l = series.length; i < l; i++) {
                if (series[i].type == ecConfig.CHART_TYPE_MAP
                    || (series[i].data && series[i].data.length > 0)
                    || (series[i].markPoint && series[i].markPoint.data && series[i].markPoint.data.length > 0)
                    || (series[i].markLine && series[i].markLine.data && series[i].markLine.data.length > 0)
                    || (series[i].nodes && series[i].nodes.length > 0)
                    || (series[i].links && series[i].links.length > 0)
                    || (series[i].matrix && series[i].matrix.length > 0)
                    || (series[i].eventList && series[i].eventList.length > 0)
                ) {
                    return false;   // 存在任意数据则为非空数据
                }
            }
            var loadOption = (this._option && this._option.noDataLoadingOption)
                || this._themeConfig.noDataLoadingOption
                || ecConfig.noDataLoadingOption
                || {
                    text: (this._option && this._option.noDataText)
                          || this._themeConfig.noDataText
                          || ecConfig.noDataText,
                    effect: (this._option && this._option.noDataEffect)
                            || this._themeConfig.noDataEffect
                            || ecConfig.noDataEffect
                };
            // 空数据
            this.clear();
            this.showLoading(loadOption);
            return true;
        },

        /**
         * 图表渲染
         */
        _render: function (magicOption) {
            this._mergeGlobalConifg(magicOption);

            if (this._noDataCheck(magicOption)) {
                return;
            }

            var bgColor = magicOption.backgroundColor;
            if (bgColor) {
                if (!_canvasSupported
                    && bgColor.indexOf('rgba') != -1
                ) {
                    // IE6~8对RGBA的处理，filter会带来其他颜色的影响
                    var cList = bgColor.split(',');
                    this.dom.style.filter = 'alpha(opacity=' +
                        cList[3].substring(0, cList[3].lastIndexOf(')')) * 100
                        + ')';
                    cList.length = 3;
                    cList[0] = cList[0].replace('a', '');
                    this.dom.style.backgroundColor = cList.join(',') + ')';
                }
                else {
                    this.dom.style.backgroundColor = bgColor;
                }
            }

            this._zr.clearAnimation();
            this._chartList = [];

            var chartLibrary = require('./chart');
            var componentLibrary = require('./component');

            if (magicOption.xAxis || magicOption.yAxis) {
                magicOption.grid = magicOption.grid || {};
                magicOption.dataZoom = magicOption.dataZoom || {};
            }

            var componentList = [
                'title', 'legend', 'tooltip', 'dataRange', 'roamController',
                'grid', 'dataZoom', 'xAxis', 'yAxis', 'polar'
            ];

            var ComponentClass;
            var componentType;
            var component;
            for (var i = 0, l = componentList.length; i < l; i++) {
                componentType = componentList[i];
                component = this.component[componentType];

                if (magicOption[componentType]) {
                    if (component) {
                        component.refresh && component.refresh(magicOption);
                    }
                    else {
                        ComponentClass = componentLibrary.get(
                            /^[xy]Axis$/.test(componentType) ? 'axis' : componentType
                        );
                        component = new ComponentClass(
                            this._themeConfig, this._messageCenter, this._zr,
                            magicOption, this, componentType
                        );
                        this.component[componentType] = component;
                    }
                    this._chartList.push(component);
                }
                else if (component) {
                    component.dispose();
                    this.component[componentType] = null;
                    delete this.component[componentType];
                }
            }

            var ChartClass;
            var chartType;
            var chart;
            var chartMap = {};      // 记录已经初始化的图表
            for (var i = 0, l = magicOption.series.length; i < l; i++) {
                chartType = magicOption.series[i].type;
                if (!chartType) {
                    console.error('series[' + i + '] chart type has not been defined.');
                    continue;
                }

                if (!chartMap[chartType]) {
                    chartMap[chartType] = true;
                    ChartClass = chartLibrary.get(chartType);
                    if (ChartClass) {
                        if (this.chart[chartType]) {
                            chart = this.chart[chartType];
                            chart.refresh(magicOption);
                        }
                        else {
                            chart = new ChartClass(
                                this._themeConfig, this._messageCenter, this._zr,
                                magicOption, this
                            );
                        }
                        this._chartList.push(chart);
                        this.chart[chartType] = chart;
                    }
                    else {
                        console.error(chartType + ' has not been required.');
                    }
                }
            }

            // 已有实例但新option不带这类图表的实例释放
            for (chartType in this.chart) {
                if (chartType != ecConfig.CHART_TYPE_ISLAND  && !chartMap[chartType]) {
                    this.chart[chartType].dispose();
                    this.chart[chartType] = null;
                    delete this.chart[chartType];
                }
            }

            this.component.grid && this.component.grid.refixAxisShape(this.component);

            this._island.refresh(magicOption);
            this._toolbox.refresh(magicOption);

            magicOption.animation && !magicOption.renderAsImage
                ? this._zr.refresh()
                : this._zr.render();

            var imgId = 'IMG' + this.id;
            var img = document.getElementById(imgId);
            if (magicOption.renderAsImage && _canvasSupported) {
                // IE8- 不支持图片渲染形式
                if (img) {
                    // 已经渲染过则更新显示
                    img.src = this.getDataURL(magicOption.renderAsImage);
                }
                else {
                    // 没有渲染过插入img dom
                    img = this.getImage(magicOption.renderAsImage);
                    img.id = imgId;
                    img.style.position = 'absolute';
                    img.style.left = 0;
                    img.style.top = 0;
                    this.dom.firstChild.appendChild(img);
                }
                this.un();
                this._zr.un();
                this._disposeChartList();
                this._zr.clear();
            }
            else if (img) {
                // 删除可能存在的img
                img.parentNode.removeChild(img);
            }
            img = null;

            this._option = magicOption;
        },

        /**
         * 还原
         */
        restore: function () {
            this._clearEffect();
            this._option = zrUtil.clone(this._optionRestore);
            this._disposeChartList();
            this._island.clear();
            this._toolbox.reset(this._option, true);
            this._render(this._option);
        },

        /**
         * 刷新
         * @param {Object=} param，可选参数，用于附带option，内部同步用，外部不建议带入数据修改，无法同步
         */
        refresh: function (param) {
            this._clearEffect();
            param = param || {};
            var magicOption = param.option;

            // 外部调用的refresh且有option带入
            if (!this._refreshInside && magicOption) {
                // 做简单的差异合并去同步内部持有的数据克隆，不建议带入数据
                // 开启数据区域缩放、拖拽重计算、数据视图可编辑模式情况下，当用户产生了数据变化后无法同步
                // 如有带入option存在数据变化，请重新setOption
                magicOption = this.getOption();
                zrUtil.merge(magicOption, param.option, true);
                zrUtil.merge(this._optionRestore, param.option, true);
                this._toolbox.reset(magicOption);
            }

            this._island.refresh(magicOption);
            this._toolbox.refresh(magicOption);

            // 停止动画
            this._zr.clearAnimation();
            // 先来后到，安顺序刷新各种图表，图表内部refresh优化检查magicOption，无需更新则不更新~
            for (var i = 0, l = this._chartList.length; i < l; i++) {
                this._chartList[i].refresh && this._chartList[i].refresh(magicOption);
            }
            this.component.grid && this.component.grid.refixAxisShape(this.component);
            this._zr.refresh();
        },

        /**
         * 释放图表实例
         */
        _disposeChartList: function () {
            this._clearEffect();

            // 停止动画
            this._zr.clearAnimation();

            var len = this._chartList.length;
            while (len--) {
                var chart = this._chartList[len];

                if (chart) {
                    var chartType = chart.type;
                    this.chart[chartType] && delete this.chart[chartType];
                    this.component[chartType] && delete this.component[chartType];
                    chart.dispose && chart.dispose();
                }
            }

            this._chartList = [];
        },

        /**
         * 非图表全局属性merge~~
         */
        _mergeGlobalConifg: function (magicOption) {
            var mergeList = [
                // 背景颜色
                'backgroundColor',

                // 拖拽重计算相关
                'calculable', 'calculableColor', 'calculableHolderColor',

                // 孤岛显示连接符
                'nameConnector', 'valueConnector',

                // 动画相关
                'animation', 'animationThreshold',
                'animationDuration', 'animationDurationUpdate',
                'animationEasing', 'addDataAnimation',

                // 默认标志图形类型列表
                'symbolList',

                // 降低图表内元素拖拽敏感度，单位ms，不建议外部干预
                'DRAG_ENABLE_TIME'
            ];

            var len = mergeList.length;
            while (len--) {
                var mergeItem = mergeList[len];
                if (magicOption[mergeItem] == null) {
                    magicOption[mergeItem] = this._themeConfig[mergeItem] != null
                        ? this._themeConfig[mergeItem]
                        : ecConfig[mergeItem];
                }
            }

            // 数值系列的颜色列表，不传则采用内置颜色，可配数组，借用zrender实例注入，会有冲突风险，先这样
            var themeColor = magicOption.color;
            if (!(themeColor && themeColor.length)) {
                themeColor = this._themeConfig.color || ecConfig.color;
            }

            this._zr.getColor = function (idx) {
                var zrColor = require('zrender/tool/color');
                return zrColor.getColor(idx, themeColor);
            };

            if (!_canvasSupported) {
                // 不支持Canvas的强制关闭动画
                magicOption.animation = false;
                magicOption.addDataAnimation = false;
            }
        },

        /**
         * 万能接口，配置图表实例任何可配置选项，多次调用时option选项做merge处理
         * @param {Object} option
         * @param {boolean=} notMerge 多次调用时option选项是默认是合并（merge）的，
         *                   如果不需求，可以通过notMerger参数为true阻止与上次option的合并
         */
        setOption: function (option, notMerge) {
            if (!option.timeline) {
                return this._setOption(option, notMerge);
            }
            else {
                return this._setTimelineOption(option);
            }
        },

        /**
         * 万能接口，配置图表实例任何可配置选项，多次调用时option选项做merge处理
         * @param {Object} option
         * @param {boolean=} notMerge 多次调用时option选项是默认是合并（merge）的，
         *                   如果不需求，可以通过notMerger参数为true阻止与上次option的合并
         * @param {boolean=} 默认false。keepTimeLine 表示从timeline组件调用而来，
         *                   表示当前行为是timeline的数据切换，保持timeline，
         *                   反之销毁timeline。 详见Issue #1601
         */
        _setOption: function (option, notMerge, keepTimeLine) {
            if (!notMerge && this._option) {
                this._option = zrUtil.merge(
                    this.getOption(),
                    zrUtil.clone(option),
                    true
                );
            }
            else {
                this._option = zrUtil.clone(option);
                !keepTimeLine && this._timeline && this._timeline.dispose();
            }

            this._optionRestore = zrUtil.clone(this._option);

            if (!this._option.series || this._option.series.length === 0) {
                this._zr.clear();
                return;
            }

            if (this.component.dataZoom                         // 存在dataZoom控件
                && (this._option.dataZoom                       // 并且新option也存在
                    || (this._option.toolbox
                        && this._option.toolbox.feature
                        && this._option.toolbox.feature.dataZoom
                        && this._option.toolbox.feature.dataZoom.show
                    )
                )
            ) {
                // dataZoom同步数据
                this.component.dataZoom.syncOption(this._option);
            }
            this._toolbox.reset(this._option);
            this._render(this._option);
            return this;
        },

        /**
         * 返回内部持有的当前显示option克隆
         */
        getOption: function () {
            var magicOption = zrUtil.clone(this._option);

            var self = this;
            function restoreOption(prop) {
                var restoreSource = self._optionRestore[prop];

                if (restoreSource) {
                    if (restoreSource instanceof Array) {
                        var len = restoreSource.length;
                        while (len--) {
                            magicOption[prop][len].data = zrUtil.clone(
                                restoreSource[len].data
                            );
                        }
                    }
                    else {
                        magicOption[prop].data = zrUtil.clone(restoreSource.data);
                    }
                }
            }

            // 横轴数据还原
            restoreOption('xAxis');

            // 纵轴数据还原
            restoreOption('yAxis');

            // 系列数据还原
            restoreOption('series');

            return magicOption;
        },

        /**
         * 数据设置快捷接口
         * @param {Array} series
         * @param {boolean=} notMerge 多次调用时option选项是默认是合并（merge）的，
         *                   如果不需求，可以通过notMerger参数为true阻止与上次option的合并。
         */
        setSeries: function (series, notMerge) {
            if (!notMerge) {
                this.setOption({series: series});
            }
            else {
                this._option.series = series;
                this.setOption(this._option, notMerge);
            }
            return this;
        },

        /**
         * 返回内部持有的当前显示series克隆
         */
        getSeries: function () {
            return this.getOption().series;
        },

        /**
         * timelineOption接口，配置图表实例任何可配置选项
         * @param {Object} option
         */
        _setTimelineOption: function(option) {
            this._timeline && this._timeline.dispose();
            var Timeline = require('./component/timeline');
            var timeline = new Timeline(
                this._themeConfig, this._messageCenter, this._zr, option, this
            );
            this._timeline = timeline;
            this.component.timeline = this._timeline;

            return this;
        },

        /**
         * 动态数据添加
         * 形参为单组数据参数，多组时为数据，内容同[seriesIdx, data, isShift, additionData]
         * @param {number} seriesIdx 系列索引
         * @param {number | Object} data 增加数据
         * @param {boolean=} isHead 是否队头加入，默认，不指定或false时为队尾插入
         * @param {boolean=} dataGrow 是否增长数据队列长度，默认，不指定或false时移出目标数组对位数据
         * @param {string=} additionData 是否增加类目轴(饼图为图例)数据，附加操作同isHead和dataGrow
         */
        addData: function (seriesIdx, data, isHead, dataGrow, additionData) {
            var params = seriesIdx instanceof Array
                ? seriesIdx
                : [[seriesIdx, data, isHead, dataGrow, additionData]];

            //this._optionRestore 和 magicOption 都要同步
            var magicOption = this.getOption();
            var optionRestore = this._optionRestore;
            var self = this;
            for (var i = 0, l = params.length; i < l; i++) {
                seriesIdx = params[i][0];
                data = params[i][1];
                isHead = params[i][2];
                dataGrow = params[i][3];
                additionData = params[i][4];

                var seriesItem = optionRestore.series[seriesIdx];
                var inMethod = isHead ? 'unshift' : 'push';
                var outMethod = isHead ? 'pop' : 'shift';
                if (seriesItem) {
                    var seriesItemData = seriesItem.data;
                    var mSeriesItemData = magicOption.series[seriesIdx].data;

                    seriesItemData[inMethod](data);
                    mSeriesItemData[inMethod](data);
                    if (!dataGrow) {
                        seriesItemData[outMethod]();
                        data = mSeriesItemData[outMethod]();
                    }

                    if (additionData != null) {
                        var legend;
                        var legendData;

                        if (seriesItem.type === ecConfig.CHART_TYPE_PIE
                            && (legend = optionRestore.legend)
                            && (legendData = legend.data)
                        ) {
                            var mLegendData = magicOption.legend.data;
                            legendData[inMethod](additionData);
                            mLegendData[inMethod](additionData);

                            if (!dataGrow) {
                                var legendDataIdx = zrUtil.indexOf(legendData, data.name);
                                legendDataIdx != -1 && legendData.splice(legendDataIdx, 1);

                                legendDataIdx = zrUtil.indexOf(mLegendData, data.name);
                                legendDataIdx != -1 && mLegendData.splice(legendDataIdx, 1);
                            }
                        }
                        else if (optionRestore.xAxis != null && optionRestore.yAxis != null) {
                            // x轴类目
                            var axisData;
                            var mAxisData;
                            var axisIdx = seriesItem.xAxisIndex || 0;

                            if (optionRestore.xAxis[axisIdx].type == null
                                || optionRestore.xAxis[axisIdx].type === 'category'
                            ) {
                                axisData = optionRestore.xAxis[axisIdx].data;
                                mAxisData = magicOption.xAxis[axisIdx].data;

                                axisData[inMethod](additionData);
                                mAxisData[inMethod](additionData);
                                if (!dataGrow) {
                                    axisData[outMethod]();
                                    mAxisData[outMethod]();
                                }
                            }

                            // y轴类目
                            axisIdx = seriesItem.yAxisIndex || 0;
                            if (optionRestore.yAxis[axisIdx].type === 'category') {
                                axisData = optionRestore.yAxis[axisIdx].data;
                                mAxisData = magicOption.yAxis[axisIdx].data;

                                axisData[inMethod](additionData);
                                mAxisData[inMethod](additionData);
                                if (!dataGrow) {
                                    axisData[outMethod]();
                                    mAxisData[outMethod]();
                                }
                            }
                        }
                    }

                    // 同步图表内状态，动画需要
                    this._option.series[seriesIdx].data = magicOption.series[seriesIdx].data;
                }
            }

            this._zr.clearAnimation();
            var chartList = this._chartList;
            var chartAnimationCount = 0;
            var chartAnimationDone = function () {
                chartAnimationCount--;
                if (chartAnimationCount === 0) {
                    animationDone();
                }
            };
            for (var i = 0, l = chartList.length; i < l; i++) {
                if (magicOption.addDataAnimation && chartList[i].addDataAnimation) {
                    chartAnimationCount++;
                    chartList[i].addDataAnimation(params, chartAnimationDone);
                }
            }

            // dataZoom同步数据
            this.component.dataZoom && this.component.dataZoom.syncOption(magicOption);

            this._option = magicOption;
            function animationDone() {
                if (!self._zr) {
                    return; // 已经被释放
                }
                self._zr.clearAnimation();
                for (var i = 0, l = chartList.length; i < l; i++) {
                    // 有addData动画就去掉过渡动画
                    chartList[i].motionlessOnce =
                        magicOption.addDataAnimation && chartList[i].addDataAnimation;
                }
                self._messageCenter.dispatch(
                    ecConfig.EVENT.REFRESH,
                    null,
                    {option: magicOption},
                    self
                );
            }

            if (!magicOption.addDataAnimation) {
                setTimeout(animationDone, 0);
            }
            return this;
        },

        /**
         * 动态[标注 | 标线]添加
         * @param {number} seriesIdx 系列索引
         * @param {Object} markData [标注 | 标线]对象，支持多个
         */
        addMarkPoint: function (seriesIdx, markData) {
            return this._addMark(seriesIdx, markData, 'markPoint');
        },

        addMarkLine: function (seriesIdx, markData) {
            return this._addMark(seriesIdx, markData, 'markLine');
        },

        _addMark: function (seriesIdx, markData, markType) {
            var series = this._option.series;
            var seriesItem;

            if (series && (seriesItem = series[seriesIdx])) {
                var seriesR = this._optionRestore.series;
                var seriesRItem = seriesR[seriesIdx];
                var markOpt = seriesItem[markType];
                var markOptR = seriesRItem[markType];

                markOpt = seriesItem[markType] = markOpt || {data: []};
                markOptR = seriesRItem[markType] = markOptR || {data: []};

                for (var key in markData) {
                    if (key === 'data') {
                        // 数据concat
                        markOpt.data = markOpt.data.concat(markData.data);
                        markOptR.data = markOptR.data.concat(markData.data);
                    }
                    else if (typeof markData[key] != 'object' || markOpt[key] == null) {
                        // 简单类型或新值直接赋值
                        markOpt[key] = markOptR[key] = markData[key];
                    }
                    else {
                        // 非数据的复杂对象merge
                        zrUtil.merge(markOpt[key], markData[key], true);
                        zrUtil.merge(markOptR[key], markData[key], true);
                    }
                }

                var chart = this.chart[seriesItem.type];
                chart && chart.addMark(seriesIdx, markData, markType);
            }

            return this;
        },

        /**
         * 动态[标注 | 标线]删除
         * @param {number} seriesIdx 系列索引
         * @param {string} markName [标注 | 标线]名称
         */
        delMarkPoint: function (seriesIdx, markName) {
            return this._delMark(seriesIdx, markName, 'markPoint');
        },

        delMarkLine: function (seriesIdx, markName) {
            return this._delMark(seriesIdx, markName, 'markLine');
        },

        _delMark: function (seriesIdx, markName, markType) {
            var series = this._option.series;
            var seriesItem;
            var mark;
            var dataArray;

            if (!(
                    series
                    && (seriesItem = series[seriesIdx])
                    && (mark = seriesItem[markType])
                    && (dataArray = mark.data)
                )
            ) {
                return this;
            }

            markName = markName.split(' > ');
            var targetIndex = -1;

            for (var i = 0, l = dataArray.length; i < l; i++) {
                var dataItem = dataArray[i];
                if (dataItem instanceof Array) {
                    if (dataItem[0].name === markName[0]
                        && dataItem[1].name === markName[1]
                    ) {
                        targetIndex = i;
                        break;
                    }
                }
                else if (dataItem.name === markName[0]) {
                    targetIndex = i;
                    break;
                }
            }

            if (targetIndex > -1) {
                dataArray.splice(targetIndex, 1);
                this._optionRestore.series[seriesIdx][markType].data.splice(targetIndex, 1);

                var chart = this.chart[seriesItem.type];
                chart && chart.delMark(seriesIdx, markName.join(' > '), markType);
            }

            return this;
        },

        /**
         * 获取当前dom
         */
        getDom: function () {
            return this.dom;
        },

        /**
         * 获取当前zrender实例，可用于添加额为的shape和深度控制
         */
        getZrender: function () {
            return this._zr;
        },

        /**
         * 获取Base64图片dataURL
         * @param {string} imgType 图片类型，支持png|jpeg，默认为png
         * @return imgDataURL
         */
        getDataURL: function (imgType) {
            if (!_canvasSupported) {
                return '';
            }

            if (this._chartList.length === 0) {
                // 渲染为图片
                var imgId = 'IMG' + this.id;
                var img = document.getElementById(imgId);
                if (img) {
                    return img.src;
                }
            }

            // 清除可能存在的tooltip元素
            var tooltip = this.component.tooltip;
            tooltip && tooltip.hideTip();

            switch (imgType) {
                case 'jpeg':
                    break;
                default:
                    imgType = 'png';
            }

            var bgColor = this._option.backgroundColor;
            if (bgColor && bgColor.replace(' ','') === 'rgba(0,0,0,0)') {
                bgColor = '#fff';
            }

            return this._zr.toDataURL('image/' + imgType, bgColor);
        },

        /**
         * 获取img
         * @param {string} imgType 图片类型，支持png|jpeg，默认为png
         * @return img dom
         */
        getImage: function (imgType) {
            var title = this._optionRestore.title;
            var imgDom = document.createElement('img');
            imgDom.src = this.getDataURL(imgType);
            imgDom.title = (title && title.text) || 'ECharts';
            return imgDom;
        },

        /**
         * 获取多图联动的Base64图片dataURL
         * @param {string} imgType 图片类型，支持png|jpeg，默认为png
         * @return imgDataURL
         */
        getConnectedDataURL: function (imgType) {
            if (!this.isConnected()) {
                return this.getDataURL(imgType);
            }

            var tempDom = this.dom;
            var imgList = {
                'self': {
                    img: this.getDataURL(imgType),
                    left: tempDom.offsetLeft,
                    top: tempDom.offsetTop,
                    right: tempDom.offsetLeft + tempDom.offsetWidth,
                    bottom: tempDom.offsetTop + tempDom.offsetHeight
                }
            };

            var minLeft = imgList.self.left;
            var minTop = imgList.self.top;
            var maxRight = imgList.self.right;
            var maxBottom = imgList.self.bottom;

            for (var c in this._connected) {
                tempDom = this._connected[c].getDom();
                imgList[c] = {
                    img: this._connected[c].getDataURL(imgType),
                    left: tempDom.offsetLeft,
                    top: tempDom.offsetTop,
                    right: tempDom.offsetLeft + tempDom.offsetWidth,
                    bottom: tempDom.offsetTop + tempDom.offsetHeight
                };

                minLeft = Math.min(minLeft, imgList[c].left);
                minTop = Math.min(minTop, imgList[c].top);
                maxRight = Math.max(maxRight, imgList[c].right);
                maxBottom = Math.max(maxBottom, imgList[c].bottom);
            }

            var zrDom = document.createElement('div');
            zrDom.style.position = 'absolute';
            zrDom.style.left = '-4000px';
            zrDom.style.width = (maxRight - minLeft) + 'px';
            zrDom.style.height = (maxBottom - minTop) + 'px';
            document.body.appendChild(zrDom);

            var zrImg = require('zrender').init(zrDom);

            var ImageShape = require('zrender/shape/Image');
            for (var c in imgList) {
                zrImg.addShape(new ImageShape({
                    style: {
                        x: imgList[c].left - minLeft,
                        y: imgList[c].top - minTop,
                        image: imgList[c].img
                    }
                }));
            }

            zrImg.render();
            var bgColor = this._option.backgroundColor;
            if (bgColor && bgColor.replace(/ /g, '') === 'rgba(0,0,0,0)') {
                bgColor = '#fff';
            }

            var image = zrImg.toDataURL('image/png', bgColor);

            setTimeout(function () {
                zrImg.dispose();
                zrDom.parentNode.removeChild(zrDom);
                zrDom = null;
            }, 100);

            return image;
        },

        /**
         * 获取多图联动的img
         * @param {string} imgType 图片类型，支持png|jpeg，默认为png
         * @return img dom
         */
        getConnectedImage: function (imgType) {
            var title = this._optionRestore.title;
            var imgDom = document.createElement('img');
            imgDom.src = this.getConnectedDataURL(imgType);
            imgDom.title = (title && title.text) || 'ECharts';
            return imgDom;
        },

        /**
         * 外部接口绑定事件
         * @param {Object} eventName 事件名称
         * @param {Object} eventListener 事件响应函数
         */
        on: function (eventName, eventListener) {
            this._messageCenterOutSide.bind(eventName, eventListener, this);
            return this;
        },

        /**
         * 外部接口解除事件绑定
         * @param {Object} eventName 事件名称
         * @param {Object} eventListener 事件响应函数
         */
        un: function (eventName, eventListener) {
            this._messageCenterOutSide.unbind(eventName, eventListener);
            return this;
        },

        /**
         * 多图联动
         * @param connectTarget{ECharts | Array <ECharts>} connectTarget 联动目标
         */
        connect: function (connectTarget) {
            if (!connectTarget) {
                return this;
            }

            if (!this._connected) {
                this._connected = {};
            }

            if (connectTarget instanceof Array) {
                for (var i = 0, l = connectTarget.length; i < l; i++) {
                    this._connected[connectTarget[i].id] = connectTarget[i];
                }
            }
            else {
                this._connected[connectTarget.id] = connectTarget;
            }

            return this;
        },

        /**
         * 解除多图联动
         * @param connectTarget{ECharts | Array <ECharts>} connectTarget 解除联动目标
         */
        disConnect: function (connectTarget) {
            if (!connectTarget || !this._connected) {
                return this;
            }

            if (connectTarget instanceof Array) {
                for (var i = 0, l = connectTarget.length; i < l; i++) {
                    delete this._connected[connectTarget[i].id];
                }
            }
            else {
                delete this._connected[connectTarget.id];
            }

            for (var k in this._connected) {
                return k, this; // 非空
            }

            // 空，转为标志位
            this._connected = false;
            return this;
        },

        /**
         * 联动事件响应
         */
        connectedEventHandler: function (param) {
            if (param.__echartsId != this.id) {
                // 来自其他联动图表的事件
                this._onevent(param);
            }
        },

        /**
         * 是否存在多图联动
         */
        isConnected: function () {
            return !!this._connected;
        },

        /**
         * 显示loading过渡
         * @param {Object} loadingOption
         */
        showLoading: function (loadingOption) {
            var effectList = {
                bar: require('zrender/loadingEffect/Bar'),
                bubble: require('zrender/loadingEffect/Bubble'),
                dynamicLine: require('zrender/loadingEffect/DynamicLine'),
                ring: require('zrender/loadingEffect/Ring'),
                spin: require('zrender/loadingEffect/Spin'),
                whirling: require('zrender/loadingEffect/Whirling')
            };
            this._toolbox.hideDataView();

            loadingOption = loadingOption || {};

            var textStyle = loadingOption.textStyle || {};
            loadingOption.textStyle = textStyle;

            var finalTextStyle = zrUtil.merge(
                zrUtil.merge(
                    zrUtil.clone(textStyle),
                    this._themeConfig.textStyle
                ),
                ecConfig.textStyle
            );

            textStyle.textFont = finalTextStyle.fontStyle + ' '
                                 + finalTextStyle.fontWeight + ' '
                                 + finalTextStyle.fontSize + 'px '
                                 + finalTextStyle.fontFamily;

            textStyle.text = loadingOption.text
                             || (this._option && this._option.loadingText)
                             || this._themeConfig.loadingText
                             || ecConfig.loadingText;

            if (loadingOption.x != null) {
                textStyle.x = loadingOption.x;
            }
            if (loadingOption.y != null) {
                textStyle.y = loadingOption.y;
            }

            loadingOption.effectOption = loadingOption.effectOption || {};
            loadingOption.effectOption.textStyle = textStyle;

            var Effect = loadingOption.effect;
            if (typeof Effect === 'string' || Effect == null) {
                Effect =  effectList[
                              loadingOption.effect
                              || (this._option && this._option.loadingEffect)
                              || this._themeConfig.loadingEffect
                              || ecConfig.loadingEffect
                          ]
                          || effectList.spin;
            }
            this._zr.showLoading(new Effect(loadingOption.effectOption));
            return this;
        },

        /**
         * 隐藏loading过渡
         */
        hideLoading: function () {
            this._zr.hideLoading();
            return this;
        },

        /**
         * 主题设置
         */
        setTheme: function (theme) {
            if (theme) {
               if (typeof theme === 'string') {
                    // 默认主题
                    switch (theme) {
                        case 'macarons':
                            theme = require('./theme/macarons');
                            break;
                        case 'infographic':
                            theme = require('./theme/infographic');
                            break;
                        default:
                            theme = {}; // require('./theme/default');
                    }
                }
                else {
                    theme = theme || {};
                }

                // // 复位默认配置
                // // this._themeConfig会被别的对象引用持有
                // // 所以不能改成this._themeConfig = {};
                // for (var key in this._themeConfig) {
                //     delete this._themeConfig[key];
                // }
                // for (var key in ecConfig) {
                //     this._themeConfig[key] = zrUtil.clone(ecConfig[key]);
                // }

                // // 颜色数组随theme，不merge
                // theme.color && (this._themeConfig.color = []);

                // // 默认标志图形类型列表，不merge
                // theme.symbolList && (this._themeConfig.symbolList = []);

                // // 应用新主题
                // zrUtil.merge(this._themeConfig, zrUtil.clone(theme), true);
                this._themeConfig = theme;
            }

            if (!_canvasSupported) {   // IE8-
                var textStyle = this._themeConfig.textStyle;
                textStyle && textStyle.fontFamily && textStyle.fontFamily2
                    && (textStyle.fontFamily = textStyle.fontFamily2);

                textStyle = ecConfig.textStyle;
                textStyle.fontFamily = textStyle.fontFamily2;
            }

            this._timeline && this._timeline.setTheme(true);
            this._optionRestore && this.restore();
        },

        /**
         * 视图区域大小变化更新，不默认绑定，供使用方按需调用
         */
        resize: function () {
            var self = this;
            return function(){
                self._clearEffect();
                self._zr.resize();
                if (self._option && self._option.renderAsImage && _canvasSupported) {
                    // 渲染为图片重走render模式
                    self._render(self._option);
                    return self;
                }
                // 停止动画
                self._zr.clearAnimation();
                self._island.resize();
                self._toolbox.resize();
                self._timeline && self._timeline.resize();
                // 先来后到，不能仅刷新自己，也不能在上一个循环中刷新，如坐标系数据改变会影响其他图表的大小
                // 所以安顺序刷新各种图表，图表内部refresh优化无需更新则不更新~
                for (var i = 0, l = self._chartList.length; i < l; i++) {
                    self._chartList[i].resize && self._chartList[i].resize();
                }
                self.component.grid && self.component.grid.refixAxisShape(self.component);
                self._zr.refresh();
                self._messageCenter.dispatch(ecConfig.EVENT.RESIZE, null, null, self);
                return self;
            };
        },

        _clearEffect: function() {
            this._zr.modLayer(ecConfig.EFFECT_ZLEVEL, { motionBlur: false });
            this._zr.painter.clearLayer(ecConfig.EFFECT_ZLEVEL);
        },

        /**
         * 清除已渲染内容 ，clear后echarts实例可用
         */
        clear: function () {
            this._disposeChartList();
            this._zr.clear();
            this._option = {};
            this._optionRestore = {};
            this.dom.style.backgroundColor = null;
            return this;
        },

        /**
         * 释放，dispose后echarts实例不可用
         */
        dispose: function () {
            var key = this.dom.getAttribute(DOM_ATTRIBUTE_KEY);
            key && delete _instances[key];

            this._island.dispose();
            this._toolbox.dispose();
            this._timeline && this._timeline.dispose();
            this._messageCenter.unbind();
            this.clear();
            this._zr.dispose();
            this._zr = null;
        }
    };

    return self;
});
define('echarts/chart/pie', ['require', './base', 'zrender/shape/Text', 'zrender/shape/Ring', 'zrender/shape/Circle', 'zrender/shape/Sector', 'zrender/shape/Polyline', '../config', '../util/ecData', 'zrender/tool/util', 'zrender/tool/math', 'zrender/tool/color', '../chart'], function (require) {
    var ChartBase = require('./base');

    // 图形依赖
    var TextShape = require('zrender/shape/Text');
    var RingShape = require('zrender/shape/Ring');
    var CircleShape = require('zrender/shape/Circle');
    var SectorShape = require('zrender/shape/Sector');
    var PolylineShape = require('zrender/shape/Polyline');

    var ecConfig = require('../config');
    // 饼图默认参数
    ecConfig.pie = {
        zlevel: 0,                  // 一级层叠
        z: 2,                       // 二级层叠
        clickable: true,
        legendHoverLink: true,
        center: ['50%', '50%'],     // 默认全局居中
        radius: [0, '75%'],
        clockWise: true,            // 默认顺时针
        startAngle: 90,
        minAngle: 0,                // 最小角度改为0
        selectedOffset: 10,         // 选中是扇区偏移量
        // selectedMode: false,     // 选择模式，默认关闭，可选single，multiple
        // roseType: null,          // 南丁格尔玫瑰图模式，'radius'（半径） | 'area'（面积）
        itemStyle: {
            normal: {
                // color: 各异,
                borderColor: 'rgba(0,0,0,0)',
                borderWidth: 1,
                label: {
                    show: true,
                    position: 'outer'
                    // formatter: 标签文本格式器，同Tooltip.formatter，不支持异步回调
                    // textStyle: null      // 默认使用全局文本样式，详见TEXTSTYLE
                    // distance: 当position为inner时有效，为label位置到圆心的距离与圆半径(环状图为内外半径和)的比例系数
                },
                labelLine: {
                    show: true,
                    length: 20,
                    lineStyle: {
                        // color: 各异,
                        width: 1,
                        type: 'solid'
                    }
                }
            },
            emphasis: {
                // color: 各异,
                borderColor: 'rgba(0,0,0,0)',
                borderWidth: 1,
                label: {
                    show: false
                    // position: 'outer'
                    // formatter: 标签文本格式器，同Tooltip.formatter，不支持异步回调
                    // textStyle: null      // 默认使用全局文本样式，详见TEXTSTYLE
                    // distance: 当position为inner时有效，为label位置到圆心的距离与圆半径(环状图为内外半径和)的比例系数
                },
                labelLine: {
                    show: false,
                    length: 20,
                    lineStyle: {
                        // color: 各异,
                        width: 1,
                        type: 'solid'
                    }
                }
            }
        }
    };

    var ecData = require('../util/ecData');
    var zrUtil = require('zrender/tool/util');
    var zrMath = require('zrender/tool/math');
    var zrColor = require('zrender/tool/color');

    /**
     * 构造函数
     * @param {Object} messageCenter echart消息中心
     * @param {ZRender} zr zrender实例
     * @param {Object} series 数据
     * @param {Object} component 组件
     */
    function Pie(ecTheme, messageCenter, zr, option, myChart){
        // 图表基类
        ChartBase.call(this, ecTheme, messageCenter, zr, option, myChart);

        var self = this;
        /**
         * 输出动态视觉引导线
         */
        self.shapeHandler.onmouseover = function (param) {
            var shape = param.target;
            var seriesIndex = ecData.get(shape, 'seriesIndex');
            var dataIndex = ecData.get(shape, 'dataIndex');
            var percent = ecData.get(shape, 'special');

            var center = [shape.style.x, shape.style.y];
            var startAngle = shape.style.startAngle;
            var endAngle = shape.style.endAngle;
            var midAngle = ((endAngle + startAngle) / 2 + 360) % 360; // 中值
            var defaultColor = shape.highlightStyle.color;

            // 文本标签，需要显示则会有返回
            var label = self.getLabel(
                    seriesIndex, dataIndex, percent,
                    center, midAngle, defaultColor,
                    true
                );

            if (label) {
                self.zr.addHoverShape(label);
            }

            // 文本标签视觉引导线，需要显示则会有返回
            var labelLine = self.getLabelLine(
                    seriesIndex, dataIndex,
                    center, shape.style.r0, shape.style.r,
                    midAngle, defaultColor,
                    true
                );

            if (labelLine) {
                self.zr.addHoverShape(labelLine);
            }
        };

        this.refresh(option);
    }

    Pie.prototype = {
        type: ecConfig.CHART_TYPE_PIE,
        /**
         * 绘制图形
         */
        _buildShape: function () {
            var series = this.series;
            var legend = this.component.legend;
            this.selectedMap = {};
            this._selected = {};
            var center;
            var radius;

            var pieCase;        // 饼图箱子
            this._selectedMode = false;
            var serieName;
            for (var i = 0, l = series.length; i < l; i++) {
                if (series[i].type === ecConfig.CHART_TYPE_PIE) {
                    series[i] = this.reformOption(series[i]);
                    this.legendHoverLink = series[i].legendHoverLink || this.legendHoverLink;
                    serieName = series[i].name || '';
                    // 系列图例开关
                    this.selectedMap[serieName] = legend ? legend.isSelected(serieName) : true;
                    if (!this.selectedMap[serieName]) {
                        continue;
                    }

                    center = this.parseCenter(this.zr, series[i].center);
                    radius = this.parseRadius(this.zr, series[i].radius);
                    this._selectedMode = this._selectedMode || series[i].selectedMode;
                    this._selected[i] = [];
                    if (this.deepQuery([series[i], this.option], 'calculable')) {
                        pieCase = {
                            zlevel: series[i].zlevel,
                            z: series[i].z,
                            hoverable: false,
                            style: {
                                x: center[0],          // 圆心横坐标
                                y: center[1],          // 圆心纵坐标
                                // 圆环内外半径
                                r0: radius[0] <= 10 ? 0 : radius[0] - 10,
                                r: radius[1] + 10,
                                brushType: 'stroke',
                                lineWidth: 1,
                                strokeColor: series[i].calculableHolderColor
                                             || this.ecTheme.calculableHolderColor
                                             || ecConfig.calculableHolderColor
                            }
                        };
                        ecData.pack(pieCase, series[i], i, undefined, -1);
                        this.setCalculable(pieCase);

                        pieCase = radius[0] <= 10
                                  ? new CircleShape(pieCase)
                                  : new RingShape(pieCase);
                        this.shapeList.push(pieCase);
                    }
                    this._buildSinglePie(i);
                    this.buildMark(i);
                }
            }

            this.addShapeList();
        },

        /**
         * 构建单个饼图
         *
         * @param {number} seriesIndex 系列索引
         */
        _buildSinglePie: function (seriesIndex) {
            var series = this.series;
            var serie = series[seriesIndex];
            var data = serie.data;
            var legend = this.component.legend;
            var itemName;
            var totalSelected = 0;               // 迭代累计选中且非0个数
            var totalSelectedValue0 = 0;         // 迭代累计选中0只个数
            var totalValue = 0;                  // 迭代累计
            var maxValue = Number.NEGATIVE_INFINITY;

            var singleShapeList = [];
            // 计算需要显示的个数和总值
            for (var i = 0, l = data.length; i < l; i++) {
                itemName = data[i].name;
                this.selectedMap[itemName] = legend ? legend.isSelected(itemName) : true;

                if (this.selectedMap[itemName] && !isNaN(data[i].value)) {
                    if (+data[i].value !== 0) {
                        totalSelected++;
                    }
                    else {
                        totalSelectedValue0++;
                    }
                    totalValue += +data[i].value;
                    maxValue = Math.max(maxValue, +data[i].value);
                }
            }

            if (totalValue === 0) {
                return;
            }

            var percent = 100;
            var clockWise = serie.clockWise;
            var startAngle = (serie.startAngle.toFixed(2) - 0 + 360) % 360;
            var endAngle;
            var minAngle = serie.minAngle || 0.01; // #bugfixed
            var totalAngle = 360 - (minAngle * totalSelected) - 0.01 * totalSelectedValue0;
            var defaultColor;
            var roseType = serie.roseType;
            var center;
            var radius;
            var r0;     // 扇形内半径
            var r1;     // 扇形外半径

            for (var i = 0, l = data.length; i < l; i++) {
                itemName = data[i].name;
                if (!this.selectedMap[itemName] || isNaN(data[i].value)) {
                    continue;
                }
                // 默认颜色策略，有图例则从图例中获取颜色定义，没有就全局颜色定义
                defaultColor = legend ? legend.getColor(itemName) : this.zr.getColor(i);

                percent = data[i].value / totalValue;
                if (roseType != 'area') {
                    endAngle = clockWise
                        ? (startAngle - percent * totalAngle - (percent !== 0 ? minAngle : 0.01))
                        : (percent * totalAngle + startAngle + (percent !== 0 ? minAngle : 0.01));
                }
                else {
                    endAngle = clockWise
                        ? (startAngle - 360 / l)
                        : (360 / l + startAngle);
                }
                endAngle = endAngle.toFixed(2) - 0;
                percent = (percent * 100).toFixed(2);

                center = this.parseCenter(this.zr, serie.center);
                radius = this.parseRadius(this.zr, serie.radius);
                r0 = +radius[0];
                r1 = +radius[1];

                if (roseType === 'radius') {
                    r1 = data[i].value / maxValue * (r1 - r0) * 0.8 + (r1 - r0) * 0.2 + r0;
                }
                else if (roseType === 'area') {
                    r1 = Math.sqrt(data[i].value / maxValue) * (r1 - r0) + r0;
                }

                if (clockWise) {
                    var temp;
                    temp = startAngle;
                    startAngle = endAngle;
                    endAngle = temp;
                }

                this._buildItem(
                    singleShapeList,
                    seriesIndex, i, percent,
                    data[i].selected,
                    center, r0, r1,
                    startAngle, endAngle, defaultColor
                );
                if (!clockWise) {
                    startAngle = endAngle;
                }
            }
            this._autoLabelLayout(singleShapeList, center, r1);
            for (var i = 0, l = singleShapeList.length; i < l; i++) {
                this.shapeList.push(singleShapeList[i]);
            }
            singleShapeList = null;
        },

        /**
         * 构建单个扇形及指标
         */
        _buildItem: function (
            singleShapeList,
            seriesIndex, dataIndex, percent,
            isSelected,
            center, r0, r1,
            startAngle, endAngle, defaultColor
        ) {
            var series = this.series;
            var midAngle = ((endAngle + startAngle) / 2 + 360) % 360; // 中值

            // 扇形
            var sector = this.getSector(
                    seriesIndex, dataIndex, percent, isSelected,
                    center, r0, r1,
                    startAngle, endAngle, defaultColor
                );
            // 图形需要附加的私有数据
            ecData.pack(
                sector,
                series[seriesIndex], seriesIndex,
                series[seriesIndex].data[dataIndex], dataIndex,
                series[seriesIndex].data[dataIndex].name,
                percent
            );
            singleShapeList.push(sector);

            // 文本标签，需要显示则会有返回
            var label = this.getLabel(
                    seriesIndex, dataIndex, percent,
                    center, midAngle, defaultColor,
                    false
                );
            // 文本标签视觉引导线，需要显示则会有返回
            var labelLine = this.getLabelLine(
                    seriesIndex, dataIndex,
                    center, r0, r1,
                    midAngle, defaultColor,
                    false
                );

            if (labelLine) {
                ecData.pack(
                    labelLine,
                    series[seriesIndex], seriesIndex,
                    series[seriesIndex].data[dataIndex], dataIndex,
                    series[seriesIndex].data[dataIndex].name,
                    percent
                );
                singleShapeList.push(labelLine);
            }
            if (label) {
                ecData.pack(
                    label,
                    series[seriesIndex], seriesIndex,
                    series[seriesIndex].data[dataIndex], dataIndex,
                    series[seriesIndex].data[dataIndex].name,
                    percent
                );
                label._labelLine = labelLine;
                singleShapeList.push(label);
            }
        },

        /**
         * 构建扇形
         */
        getSector: function (
            seriesIndex, dataIndex, percent, isSelected,
            center, r0, r1,
            startAngle, endAngle, defaultColor
        ) {
            var series = this.series;
            var serie = series[seriesIndex];
            var data = serie.data[dataIndex];
            var queryTarget = [data, serie];

            // 多级控制
            var normal = this.deepMerge(
                queryTarget,
                'itemStyle.normal'
            ) || {};
            var emphasis = this.deepMerge(
                queryTarget,
                'itemStyle.emphasis'
            ) || {};
            var normalColor = this.getItemStyleColor(normal.color, seriesIndex, dataIndex, data)
                              || defaultColor;

            var emphasisColor = this.getItemStyleColor(emphasis.color, seriesIndex, dataIndex, data)
                || (typeof normalColor === 'string'
                    ? zrColor.lift(normalColor, -0.2)
                    : normalColor
                );

            var sector = {
                zlevel: serie.zlevel,
                z: serie.z,
                clickable: this.deepQuery(queryTarget, 'clickable'),
                style: {
                    x: center[0],          // 圆心横坐标
                    y: center[1],          // 圆心纵坐标
                    r0: r0,         // 圆环内半径
                    r: r1,          // 圆环外半径
                    startAngle: startAngle,
                    endAngle: endAngle,
                    brushType: 'both',
                    color: normalColor,
                    lineWidth: normal.borderWidth,
                    strokeColor: normal.borderColor,
                    lineJoin: 'round'
                },
                highlightStyle: {
                    color: emphasisColor,
                    lineWidth: emphasis.borderWidth,
                    strokeColor: emphasis.borderColor,
                    lineJoin: 'round'
                },
                _seriesIndex: seriesIndex,
                _dataIndex: dataIndex
            };

            if (isSelected) {
                var midAngle =
                    ((sector.style.startAngle + sector.style.endAngle) / 2).toFixed(2) - 0;
                sector.style._hasSelected = true;
                sector.style._x = sector.style.x;
                sector.style._y = sector.style.y;
                var offset = this.query(serie, 'selectedOffset');
                sector.style.x += zrMath.cos(midAngle, true) * offset;
                sector.style.y -= zrMath.sin(midAngle, true) * offset;

                this._selected[seriesIndex][dataIndex] = true;
            }
            else {
                this._selected[seriesIndex][dataIndex] = false;
            }


            if (this._selectedMode) {
                sector.onclick = this.shapeHandler.onclick;
            }

            if (this.deepQuery([data, serie, this.option], 'calculable')) {
                this.setCalculable(sector);
                sector.draggable = true;
            }

            // “emphasis显示”添加事件响应
            if (this._needLabel(serie, data, true)          // emphasis下显示文本
                || this._needLabelLine(serie, data, true)   // emphasis下显示引导线
            ) {
                sector.onmouseover = this.shapeHandler.onmouseover;
            }

            sector = new SectorShape(sector);
            return sector;
        },

        /**
         * 需要显示则会有返回构建好的shape，否则返回undefined
         */
        getLabel: function (
            seriesIndex, dataIndex, percent,
            center, midAngle, defaultColor,
            isEmphasis
        ) {
            var series = this.series;
            var serie = series[seriesIndex];
            var data = serie.data[dataIndex];

            // 特定状态下是否需要显示文本标签
            if (!this._needLabel(serie, data, isEmphasis)) {
                return;
            }

            var status = isEmphasis ? 'emphasis' : 'normal';

            // serie里有默认配置，放心大胆的用！
            var itemStyle = zrUtil.merge(
                    zrUtil.clone(data.itemStyle) || {},
                    serie.itemStyle
                );
            // label配置
            var labelControl = itemStyle[status].label;
            var textStyle = labelControl.textStyle || {};

            var centerX = center[0];                      // 圆心横坐标
            var centerY = center[1];                      // 圆心纵坐标
            var x;
            var y;
            var radius = this.parseRadius(this.zr, serie.radius);  // 标签位置半径
            var textAlign;
            var textBaseline = 'middle';
            labelControl.position = labelControl.position
                                    || itemStyle.normal.label.position;
            if (labelControl.position === 'center') {
                // center显示
                x = centerX;
                y = centerY;
                textAlign = 'center';
            }
            else if (labelControl.position === 'inner' || labelControl.position === 'inside') {
                // 内部标签显示, 按外半径比例计算标签位置
                radius = (radius[0] + radius[1]) * (labelControl.distance || 0.5);
                x = Math.round(centerX + radius * zrMath.cos(midAngle, true));
                y = Math.round(centerY - radius * zrMath.sin(midAngle, true));
                defaultColor = '#fff';
                textAlign = 'center';
            }
            else {
                // 外部显示，默认 labelControl.position === 'outer')
                radius = radius[1] - (-itemStyle[status].labelLine.length);
                x = Math.round(centerX + radius * zrMath.cos(midAngle, true));
                y = Math.round(centerY - radius * zrMath.sin(midAngle, true));
                textAlign = (midAngle >= 90 && midAngle <= 270) ? 'right' : 'left';
            }

            if (labelControl.position != 'center'
                && labelControl.position != 'inner'
                && labelControl.position != 'inside'
            ) {
                x += textAlign === 'left' ? 20 : -20;
            }
            data.__labelX = x - (textAlign === 'left' ? 5 : -5);
            data.__labelY = y;

            var ts = new TextShape({
                zlevel: serie.zlevel,
                z: serie.z + 1,
                hoverable: false,
                style: {
                    x: x,
                    y: y,
                    color: textStyle.color || defaultColor,
                    text: this.getLabelText(seriesIndex, dataIndex, percent, status),
                    textAlign: textStyle.align || textAlign,
                    textBaseline: textStyle.baseline || textBaseline,
                    textFont: this.getFont(textStyle)
                },
                highlightStyle: {
                    brushType: 'fill'
                }
            });
            ts._radius = radius;
            ts._labelPosition = labelControl.position || 'outer';
            ts._rect = ts.getRect(ts.style);
            ts._seriesIndex = seriesIndex;
            ts._dataIndex = dataIndex;
            return ts;

        },

        /**
         * 根据lable.format计算label text
         */
        getLabelText: function (seriesIndex, dataIndex, percent, status) {
            var series = this.series;
            var serie = series[seriesIndex];
            var data = serie.data[dataIndex];
            var formatter = this.deepQuery(
                [data, serie],
                'itemStyle.' + status + '.label.formatter'
            );

            if (formatter) {
                if (typeof formatter === 'function') {
                    return formatter.call(
                        this.myChart,
                        {
                            seriesIndex: seriesIndex,
                            seriesName: serie.name || '',
                            series: serie,
                            dataIndex: dataIndex,
                            data: data,
                            name: data.name,
                            value: data.value,
                            percent: percent
                        }
                    );
                }
                else if (typeof formatter === 'string') {
                    formatter = formatter.replace('{a}','{a0}')
                                         .replace('{b}','{b0}')
                                         .replace('{c}','{c0}')
                                         .replace('{d}','{d0}');
                    formatter = formatter.replace('{a0}', serie.name)
                                         .replace('{b0}', data.name)
                                         .replace('{c0}', data.value)
                                         .replace('{d0}', percent);

                    return formatter;
                }
            }
            else {
                return data.name;
            }
        },

        /**
         * 需要显示则会有返回构建好的shape，否则返回undefined
         */
        getLabelLine: function (
            seriesIndex, dataIndex,
            center, r0, r1,
            midAngle, defaultColor,
            isEmphasis
        ) {
            var series = this.series;
            var serie = series[seriesIndex];
            var data = serie.data[dataIndex];

            // 特定状态下是否需要显示文本标签
            if (this._needLabelLine(serie, data, isEmphasis)) {
                var status = isEmphasis ? 'emphasis' : 'normal';

                // serie里有默认配置，放心大胆的用！
                var itemStyle = zrUtil.merge(
                        zrUtil.clone(data.itemStyle) || {},
                        serie.itemStyle
                    );
                // labelLine配置
                var labelLineControl = itemStyle[status].labelLine;
                var lineStyle = labelLineControl.lineStyle || {};

                var centerX = center[0];                    // 圆心横坐标
                var centerY = center[1];                    // 圆心纵坐标
                // 视觉引导线起点半径
                var minRadius = r1;
                // 视觉引导线终点半径
                var maxRadius = this.parseRadius(this.zr, serie.radius)[1]
                                - (-labelLineControl.length);
                var cosValue = zrMath.cos(midAngle, true);
                var sinValue = zrMath.sin(midAngle, true);

                return new PolylineShape({
                    zlevel: serie.zlevel,
                    z: serie.z + 1,
                    hoverable: false,
                    style: {
                        pointList: [
                            [
                                centerX + minRadius * cosValue,
                                centerY - minRadius * sinValue
                            ],
                            [
                                centerX + maxRadius * cosValue,
                                centerY - maxRadius * sinValue
                            ],
                            [
                                data.__labelX,
                                data.__labelY
                            ]
                        ],
                        //xStart: centerX + minRadius * cosValue,
                        //yStart: centerY - minRadius * sinValue,
                        //xEnd: centerX + maxRadius * cosValue,
                        //yEnd: centerY - maxRadius * sinValue,
                        strokeColor: lineStyle.color || defaultColor,
                        lineType: lineStyle.type,
                        lineWidth: lineStyle.width
                    },
                    _seriesIndex: seriesIndex,
                    _dataIndex: dataIndex
                });
            }
            else {
                return;
            }
        },

        /**
         * 返回特定状态（normal or emphasis）下是否需要显示label标签文本
         * @param {Object} serie
         * @param {Object} data
         * @param {boolean} isEmphasis true is 'emphasis' and false is 'normal'
         */
        _needLabel: function (serie, data, isEmphasis) {
            return this.deepQuery(
                [data, serie],
                'itemStyle.'
                + (isEmphasis ? 'emphasis' : 'normal')
                + '.label.show'
            );
        },

        /**
         * 返回特定状态（normal or emphasis）下是否需要显示labelLine标签视觉引导线
         * @param {Object} serie
         * @param {Object} data
         * @param {boolean} isEmphasis true is 'emphasis' and false is 'normal'
         */
        _needLabelLine: function (serie, data, isEmphasis) {
            return this.deepQuery(
                [data, serie],
                'itemStyle.'
                + (isEmphasis ? 'emphasis' : 'normal')
                +'.labelLine.show'
            );
        },

        /**
         * @param {Array.<Object>} sList 单系列图形集合
         */
        _autoLabelLayout : function (sList, center, r) {
            var leftList = [];
            var rightList = [];

            for (var i = 0, l = sList.length; i < l; i++) {
                if (sList[i]._labelPosition === 'outer' || sList[i]._labelPosition === 'outside') {
                    sList[i]._rect._y = sList[i]._rect.y;
                    if (sList[i]._rect.x < center[0]) {
                        leftList.push(sList[i]);
                    }
                    else {
                        rightList.push(sList[i]);
                    }
                }
            }
            this._layoutCalculate(leftList, center, r, -1);
            this._layoutCalculate(rightList, center, r, 1);
        },

        /**
         * @param {Array.<Object>} tList 单系列文本图形集合
         * @param {number} direction 水平方向参数，left为-1，right为1
         */
        _layoutCalculate : function(tList, center, r, direction) {
            tList.sort(function(a, b){
                return a._rect.y - b._rect.y;
            });

            // 压
            function _changeDown(start, end, delta, direction) {
                for (var j = start; j < end; j++) {
                    tList[j]._rect.y += delta;
                    tList[j].style.y += delta;
                    if (tList[j]._labelLine) {
                        tList[j]._labelLine.style.pointList[1][1] += delta;
                        tList[j]._labelLine.style.pointList[2][1] += delta;
                    }
                    if (j > start
                        && j + 1 < end
                        && tList[j + 1]._rect.y > tList[j]._rect.y + tList[j]._rect.height
                    ) {
                        _changeUp(j, delta / 2);
                        return;
                    }
                }

                _changeUp(end - 1, delta / 2);
            }

            // 弹
            function _changeUp(end, delta) {
                for (var j = end; j >= 0; j--) {
                    tList[j]._rect.y -= delta;
                    tList[j].style.y -= delta;
                    if (tList[j]._labelLine) {
                        tList[j]._labelLine.style.pointList[1][1] -= delta;
                        tList[j]._labelLine.style.pointList[2][1] -= delta;
                    }
                    if (j > 0
                        && tList[j]._rect.y > tList[j - 1]._rect.y + tList[j - 1]._rect.height
                    ) {
                        break;
                    }
                }
            }

            function _changeX(sList, isDownList, center, r, direction) {
                var x = center[0];
                var y = center[1];
                var deltaX;
                var deltaY;
                var length;
                var lastDeltaX = direction > 0
                    ? isDownList                // 右侧
                        ? Number.MAX_VALUE      // 下
                        : 0                     // 上
                    : isDownList                // 左侧
                        ? Number.MAX_VALUE      // 下
                        : 0;                    // 上

                for (var i = 0, l = sList.length; i < l; i++) {
                    deltaY = Math.abs(sList[i]._rect.y - y);
                    length = sList[i]._radius - r;
                    deltaX = (deltaY < r + length)
                        ? Math.sqrt(
                              (r + length + 20) * (r + length + 20)
                              - Math.pow(sList[i]._rect.y - y, 2)
                          )
                        : Math.abs(
                              sList[i]._rect.x + (direction > 0 ? 0 : sList[i]._rect.width) - x
                          );
                    if (isDownList && deltaX >= lastDeltaX) {
                        // 右下，左下
                        deltaX = lastDeltaX - 10;
                    }
                    if (!isDownList && deltaX <= lastDeltaX) {
                        // 右上，左上
                        deltaX = lastDeltaX + 10;
                    }

                    sList[i]._rect.x = sList[i].style.x = x + deltaX * direction;
                    if (sList[i]._labelLine) {
                        sList[i]._labelLine.style.pointList[2][0] = x + (deltaX - 5) * direction;
                        sList[i]._labelLine.style.pointList[1][0] = x + (deltaX - 20) *direction;
                    }
                    lastDeltaX = deltaX;
                }
            }

            var lastY = 0;
            var delta;
            var len = tList.length;
            var upList = [];
            var downList = [];
            for (var i = 0; i < len; i++) {
                delta = tList[i]._rect.y - lastY;
                if (delta < 0) {
                    _changeDown(i, len, -delta, direction);
                }
                lastY = tList[i]._rect.y + tList[i]._rect.height;
            }
            if (this.zr.getHeight() - lastY < 0) {
                _changeUp(len - 1, lastY - this.zr.getHeight());
            }
            for (var i = 0; i < len; i++) {
                if (tList[i]._rect.y >= center[1]) {
                    downList.push(tList[i]);
                }
                else {
                    upList.push(tList[i]);
                }
            }
            _changeX(downList, true, center, r, direction);
            _changeX(upList, false, center, r, direction);
        },

        /**
         * 参数修正&默认值赋值，重载基类方法
         * @param {Object} opt 参数
         */
        reformOption: function (opt) {
            // 常用方法快捷方式
            var _merge = zrUtil.merge;
            opt = _merge(
                      _merge(
                          opt || {}, zrUtil.clone(this.ecTheme.pie || {})
                      ),
                      zrUtil.clone(ecConfig.pie)
                  );

            // 通用字体设置
            opt.itemStyle.normal.label.textStyle = this.getTextStyle(
                opt.itemStyle.normal.label.textStyle
            );
            opt.itemStyle.emphasis.label.textStyle = this.getTextStyle(
                opt.itemStyle.emphasis.label.textStyle
            );
            this.z = opt.z;
            this.zlevel = opt.zlevel;
            return opt;
        },

        /**
         * 刷新
         */
        refresh: function (newOption) {
            if (newOption) {
                this.option = newOption;
                this.series = newOption.series;
            }

            this.backupShapeList();
            this._buildShape();
        },

        /**
         * 动态数据增加动画
         */
        addDataAnimation: function (params, done) {
            var series = this.series;
            var aniMap = {}; // seriesIndex索引参数
            for (var i = 0, l = params.length; i < l; i++) {
                aniMap[params[i][0]] = params[i];
            }

            var aniCount = 0;
            function animationDone() {
                aniCount--;
                if (aniCount === 0) {
                    done && done();
                }
            }

            // 构建新的饼图匹配差异做动画
            var sectorMap = {};
            var textMap = {};
            var lineMap = {};
            var backupShapeList = this.shapeList;
            this.shapeList = [];

            var seriesIndex;
            var isHead;
            var dataGrow;
            var deltaIdxMap = {};   // 修正新增数据后会对dataIndex产生错位匹配
            for (var i = 0, l = params.length; i < l; i++) {
                seriesIndex = params[i][0];
                isHead = params[i][2];
                dataGrow = params[i][3];
                if (series[seriesIndex]
                    && series[seriesIndex].type === ecConfig.CHART_TYPE_PIE
                ) {
                    if (isHead) {
                        if (!dataGrow) {
                            sectorMap[
                                seriesIndex
                                + '_'
                                + series[seriesIndex].data.length
                            ] = 'delete';
                        }
                        deltaIdxMap[seriesIndex] = 1;
                    }
                    else {
                        if (!dataGrow) {
                            sectorMap[seriesIndex + '_-1'] = 'delete';
                            deltaIdxMap[seriesIndex] = -1;
                        }
                        else {
                            deltaIdxMap[seriesIndex] = 0;
                        }
                    }
                    this._buildSinglePie(seriesIndex);
                }
            }
            var dataIndex;
            var key;
            for (var i = 0, l = this.shapeList.length; i < l; i++) {
                seriesIndex = this.shapeList[i]._seriesIndex;
                dataIndex = this.shapeList[i]._dataIndex;
                key = seriesIndex + '_' + dataIndex;
                // map映射让n*n变n
                switch (this.shapeList[i].type) {
                    case 'sector' :
                        sectorMap[key] = this.shapeList[i];
                        break;
                    case 'text' :
                        textMap[key] = this.shapeList[i];
                        break;
                    case 'polyline' :
                        lineMap[key] = this.shapeList[i];
                        break;
                }
            }
            this.shapeList = [];
            var targeSector;
            for (var i = 0, l = backupShapeList.length; i < l; i++) {
                seriesIndex = backupShapeList[i]._seriesIndex;
                if (aniMap[seriesIndex]) {
                    dataIndex = backupShapeList[i]._dataIndex
                                + deltaIdxMap[seriesIndex];
                    key = seriesIndex + '_' + dataIndex;
                    targeSector = sectorMap[key];
                    if (!targeSector) {
                        continue;
                    }
                    if (backupShapeList[i].type === 'sector') {
                        if (targeSector != 'delete') {
                            aniCount++;
                            // 原有扇形
                            this.zr.animate(backupShapeList[i].id, 'style')
                                .when(
                                    400,
                                    {
                                        startAngle: targeSector.style.startAngle,
                                        endAngle: targeSector.style.endAngle
                                    }
                                )
                                .done(animationDone)
                                .start();
                        }
                        else {
                            aniCount++;
                            // 删除的扇形
                            this.zr.animate(backupShapeList[i].id, 'style')
                                .when(
                                    400,
                                    deltaIdxMap[seriesIndex] < 0
                                    ? { startAngle: backupShapeList[i].style.startAngle }
                                    : { endAngle: backupShapeList[i].style.endAngle }
                                )
                                .done(animationDone)
                                .start();
                        }
                    }
                    else if (backupShapeList[i].type === 'text'
                             || backupShapeList[i].type === 'polyline'
                    ) {
                        if (targeSector === 'delete') {
                            // 删除逻辑一样
                            this.zr.delShape(backupShapeList[i].id);
                        }
                        else {
                            // 懒得新建变量了，借用一下
                            switch (backupShapeList[i].type) {
                                case 'text':
                                    aniCount++;
                                    targeSector = textMap[key];
                                    this.zr.animate(backupShapeList[i].id, 'style')
                                        .when(
                                            400,
                                            {
                                                x :targeSector.style.x,
                                                y :targeSector.style.y
                                            }
                                        )
                                        .done(animationDone)
                                        .start();
                                    break;
                                case 'polyline':
                                    aniCount++;
                                    targeSector = lineMap[key];
                                    this.zr.animate(backupShapeList[i].id, 'style')
                                        .when(
                                            400,
                                            {
                                                pointList:targeSector.style.pointList
                                            }
                                        )
                                        .done(animationDone)
                                        .start();
                                    break;
                            }

                        }
                    }
                }
            }
            this.shapeList = backupShapeList;

            // 没有动画
            if (!aniCount) {
                done && done();
            }
        },

        onclick: function (param) {
            var series = this.series;
            if (!this.isClick || !param.target) {
                // 没有在当前实例上发生点击直接返回
                return;
            }
            this.isClick = false;
            var offset;             // 偏移
            var target = param.target;
            var style = target.style;
            var seriesIndex = ecData.get(target, 'seriesIndex');
            var dataIndex = ecData.get(target, 'dataIndex');

            for (var i = 0, len = this.shapeList.length; i < len; i++) {
                if (this.shapeList[i].id === target.id) {
                    seriesIndex = ecData.get(target, 'seriesIndex');
                    dataIndex = ecData.get(target, 'dataIndex');
                    // 当前点击的
                    if (!style._hasSelected) {
                        var midAngle =
                            ((style.startAngle + style.endAngle) / 2)
                            .toFixed(2) - 0;
                        target.style._hasSelected = true;
                        this._selected[seriesIndex][dataIndex] = true;
                        target.style._x = target.style.x;
                        target.style._y = target.style.y;
                        offset = this.query(
                            series[seriesIndex],
                            'selectedOffset'
                        );
                        target.style.x += zrMath.cos(midAngle, true)
                                          * offset;
                        target.style.y -= zrMath.sin(midAngle, true)
                                          * offset;
                    }
                    else {
                        // 复位
                        target.style.x = target.style._x;
                        target.style.y = target.style._y;
                        target.style._hasSelected = false;
                        this._selected[seriesIndex][dataIndex] = false;
                    }

                    this.zr.modShape(target.id);
                }
                else if (this.shapeList[i].style._hasSelected
                         && this._selectedMode === 'single'
                ) {
                    seriesIndex = ecData.get(this.shapeList[i], 'seriesIndex');
                    dataIndex = ecData.get(this.shapeList[i], 'dataIndex');
                    // 单选模式下需要取消其他已经选中的
                    this.shapeList[i].style.x = this.shapeList[i].style._x;
                    this.shapeList[i].style.y = this.shapeList[i].style._y;
                    this.shapeList[i].style._hasSelected = false;
                    this._selected[seriesIndex][dataIndex] = false;
                    this.zr.modShape(this.shapeList[i].id);
                }
            }

            this.messageCenter.dispatch(
                ecConfig.EVENT.PIE_SELECTED,
                param.event,
                {
                    selected: this._selected,
                    target:  ecData.get(target, 'name')
                },
                this.myChart
            );
            this.zr.refreshNextFrame();
        }
    };

    zrUtil.inherits(Pie, ChartBase);

    // 图表注册
    require('../chart').define('pie', Pie);

    return Pie;
});
define('echarts/config', [], function () {
    // 请原谅我这样写，这显然可以直接返回个对象，但那样的话outline就显示不出来了~~
    var config = {
        // 图表类型
        CHART_TYPE_LINE: 'line',
        CHART_TYPE_BAR: 'bar',
        CHART_TYPE_SCATTER: 'scatter',
        CHART_TYPE_PIE: 'pie',
        CHART_TYPE_RADAR: 'radar',
        CHART_TYPE_VENN: 'venn',
        CHART_TYPE_TREEMAP: 'treemap',
        CHART_TYPE_TREE: 'tree',
        CHART_TYPE_MAP: 'map',
        CHART_TYPE_K: 'k',
        CHART_TYPE_ISLAND: 'island',
        CHART_TYPE_FORCE: 'force',
        CHART_TYPE_CHORD: 'chord',
        CHART_TYPE_GAUGE: 'gauge',
        CHART_TYPE_FUNNEL: 'funnel',
        CHART_TYPE_EVENTRIVER: 'eventRiver',
        CHART_TYPE_WORDCLOUD: 'wordCloud',

        // 组件类型
        COMPONENT_TYPE_TITLE: 'title',
        COMPONENT_TYPE_LEGEND: 'legend',
        COMPONENT_TYPE_DATARANGE: 'dataRange',
        COMPONENT_TYPE_DATAVIEW: 'dataView',
        COMPONENT_TYPE_DATAZOOM: 'dataZoom',
        COMPONENT_TYPE_TOOLBOX: 'toolbox',
        COMPONENT_TYPE_TOOLTIP: 'tooltip',
        COMPONENT_TYPE_GRID: 'grid',
        COMPONENT_TYPE_AXIS: 'axis',
        COMPONENT_TYPE_POLAR: 'polar',
        COMPONENT_TYPE_X_AXIS: 'xAxis',
        COMPONENT_TYPE_Y_AXIS: 'yAxis',
        COMPONENT_TYPE_AXIS_CATEGORY: 'categoryAxis',
        COMPONENT_TYPE_AXIS_VALUE: 'valueAxis',
        COMPONENT_TYPE_TIMELINE: 'timeline',
        COMPONENT_TYPE_ROAMCONTROLLER: 'roamController',

        // 全图默认背景
        backgroundColor: 'rgba(0,0,0,0)',
        
        // 默认色板
        color: ['#ff7f50','#87cefa','#da70d6','#32cd32','#6495ed',
                '#ff69b4','#ba55d3','#cd5c5c','#ffa500','#40e0d0',
                '#1e90ff','#ff6347','#7b68ee','#00fa9a','#ffd700',
                '#6699FF','#ff6666','#3cb371','#b8860b','#30e0e0'],

        markPoint: {
            clickable: true,
            symbol: 'pin',         // 标注类型
            symbolSize: 10,        // 标注大小，半宽（半径）参数，当图形为方向或菱形则总宽度为symbolSize * 2
            // symbolRotate: null, // 标注旋转控制
            large: false,
            effect: {
                show: false,
                loop: true,
                period: 15,             // 运动周期，无单位，值越大越慢
                type: 'scale',          // 可用为 scale | bounce
                scaleSize: 2,           // 放大倍数，以markPoint点size为基准
                bounceDistance: 10     // 跳动距离，单位px
                // color: 'gold',
                // shadowColor: 'rgba(255,215,0,0.8)',
                // shadowBlur: 0          // 炫光模糊
            },
            itemStyle: {
                normal: {
                    // color: 各异，
                    // borderColor: 各异,        // 标注边线颜色，优先于color 
                    borderWidth: 2,             // 标注边线线宽，单位px，默认为1
                    label: {
                        show: true,
                        // 标签文本格式器，同Tooltip.formatter，不支持回调
                        // formatter: null,
                        position: 'inside'      // 可选为'left'|'right'|'top'|'bottom'
                        // textStyle: null      // 默认使用全局文本样式，详见TEXTSTYLE
                    }
                },
                emphasis: {
                    // color: 各异
                    label: {
                        show: true
                        // 标签文本格式器，同Tooltip.formatter，不支持回调
                        // formatter: null,
                        // position: 'inside'  // 'left'|'right'|'top'|'bottom'
                        // textStyle: null     // 默认使用全局文本样式，详见TEXTSTYLE
                    }
                }
            }
        },
        
        markLine: {
            clickable: true,
            // 标线起始和结束的symbol介绍类型，如果都一样，可以直接传string
            symbol: ['circle', 'arrow'],
            // 标线起始和结束的symbol大小，半宽（半径）参数，当图形为方向或菱形则总宽度为symbolSize * 2
            symbolSize: [2, 4],
            // 标线起始和结束的symbol旋转控制
            //symbolRotate: null,
            //smooth: false,
            smoothness: 0.2,    // 平滑度
            precision: 2,
            effect: {
                show: false,
                loop: true,
                period: 15,                     // 运动周期，无单位，值越大越慢
                scaleSize: 2                    // 放大倍数，以markLine线lineWidth为基准
                // color: 'gold',
                // shadowColor: 'rgba(255,215,0,0.8)',
                // shadowBlur: lineWidth * 2    // 炫光模糊，默认等于scaleSize计算所得
            },
            // 边捆绑
            bundling: {
                enable: false,
                // [0, 90]
                maxTurningAngle: 45
            },
            itemStyle: {
                normal: {
                    // color: 各异,               // 标线主色，线色，symbol主色
                    // borderColor: 随color,     // 标线symbol边框颜色，优先于color 
                    borderWidth: 1.5,           // 标线symbol边框线宽，单位px，默认为2
                    label: {
                        show: true,
                        // 标签文本格式器，同Tooltip.formatter，不支持回调
                        // formatter: null,
                        // 可选为 'start'|'end'|'left'|'right'|'top'|'bottom'
                        position: 'end'
                        // textStyle: null      // 默认使用全局文本样式，详见TEXTSTYLE
                    },
                    lineStyle: {
                        // color: 随borderColor, // 主色，线色，优先级高于borderColor和color
                        // width: 随borderWidth, // 优先于borderWidth
                        type: 'dashed'
                        // shadowColor: 'rgba(0,0,0,0)', //默认透明
                        // shadowBlur: 0,
                        // shadowOffsetX: 0,
                        // shadowOffsetY: 0
                    }
                },
                emphasis: {
                    // color: 各异
                    label: {
                        show: false
                        // 标签文本格式器，同Tooltip.formatter，不支持回调
                        // formatter: null,
                        // position: 'inside' // 'left'|'right'|'top'|'bottom'
                        // textStyle: null    // 默认使用全局文本样式，详见TEXTSTYLE
                    },
                    lineStyle: {}
                }
            }
        },

        // 主题，主题
        textStyle: {
            decoration: 'none',
            fontFamily: 'Arial, Verdana, sans-serif',
            fontFamily2: '微软雅黑',    // IE8- 字体模糊并且，不支持不同字体混排，额外指定一份
            fontSize: 12,
            fontStyle: 'normal',
            fontWeight: 'normal'
        },

        EVENT: {
            // -------全局通用
            REFRESH: 'refresh',
            RESTORE: 'restore',
            RESIZE: 'resize',
            CLICK: 'click',
            DBLCLICK: 'dblclick',
            HOVER: 'hover',
            MOUSEOUT: 'mouseout',
            //MOUSEWHEEL: 'mousewheel',
            // -------业务交互逻辑
            DATA_CHANGED: 'dataChanged',
            DATA_ZOOM: 'dataZoom',
            DATA_RANGE: 'dataRange',
            DATA_RANGE_SELECTED: 'dataRangeSelected',
            DATA_RANGE_HOVERLINK: 'dataRangeHoverLink',
            LEGEND_SELECTED: 'legendSelected',
            LEGEND_HOVERLINK: 'legendHoverLink',
            MAP_SELECTED: 'mapSelected',
            PIE_SELECTED: 'pieSelected',
            MAGIC_TYPE_CHANGED: 'magicTypeChanged',
            DATA_VIEW_CHANGED: 'dataViewChanged',
            TIMELINE_CHANGED: 'timelineChanged',
            MAP_ROAM: 'mapRoam',
            FORCE_LAYOUT_END: 'forceLayoutEnd',
            // -------内部通信
            TOOLTIP_HOVER: 'tooltipHover',
            TOOLTIP_IN_GRID: 'tooltipInGrid',
            TOOLTIP_OUT_GRID: 'tooltipOutGrid',
            ROAMCONTROLLER: 'roamController'
        },
        DRAG_ENABLE_TIME: 120,   // 降低图表内元素拖拽敏感度，单位ms，不建议外部干预
        EFFECT_ZLEVEL : 10,       // 特效动画zlevel
        // 主题，默认标志图形类型列表
        symbolList: [
          'circle', 'rectangle', 'triangle', 'diamond',
          'emptyCircle', 'emptyRectangle', 'emptyTriangle', 'emptyDiamond'
        ],
        loadingEffect: 'spin',
        loadingText: '数据读取中...',
        noDataEffect: 'bubble',
        noDataText: '暂无数据',
        // noDataLoadingOption: null,
        // 可计算特性配置，孤岛，提示颜色
        calculable: false,                      // 默认关闭可计算特性
        calculableColor: 'rgba(255,165,0,0.6)', // 拖拽提示边框颜色
        calculableHolderColor: '#ccc',          // 可计算占位提示颜色
        nameConnector: ' & ',
        valueConnector: ': ',
        animation: true,                // 过渡动画是否开启
        addDataAnimation: true,         // 动态数据接口是否开启动画效果
        animationThreshold: 2000,       // 动画元素阀值，产生的图形原素超过2000不出动画
        animationDuration: 2000,        // 过渡动画参数：进入
        animationDurationUpdate: 500,   // 过渡动画参数：更新
        animationEasing: 'ExponentialOut'    //BounceOut
    };

    return config;
});
define('zrender/tool/env', [], function () {
    // Zepto.js
    // (c) 2010-2013 Thomas Fuchs
    // Zepto.js may be freely distributed under the MIT license.

    function detect(ua) {
        var os = this.os = {};
        var browser = this.browser = {};
        var webkit = ua.match(/Web[kK]it[\/]{0,1}([\d.]+)/);
        var android = ua.match(/(Android);?[\s\/]+([\d.]+)?/);
        var ipad = ua.match(/(iPad).*OS\s([\d_]+)/);
        var ipod = ua.match(/(iPod)(.*OS\s([\d_]+))?/);
        var iphone = !ipad && ua.match(/(iPhone\sOS)\s([\d_]+)/);
        var webos = ua.match(/(webOS|hpwOS)[\s\/]([\d.]+)/);
        var touchpad = webos && ua.match(/TouchPad/);
        var kindle = ua.match(/Kindle\/([\d.]+)/);
        var silk = ua.match(/Silk\/([\d._]+)/);
        var blackberry = ua.match(/(BlackBerry).*Version\/([\d.]+)/);
        var bb10 = ua.match(/(BB10).*Version\/([\d.]+)/);
        var rimtabletos = ua.match(/(RIM\sTablet\sOS)\s([\d.]+)/);
        var playbook = ua.match(/PlayBook/);
        var chrome = ua.match(/Chrome\/([\d.]+)/) || ua.match(/CriOS\/([\d.]+)/);
        var firefox = ua.match(/Firefox\/([\d.]+)/);
        var ie = ua.match(/MSIE ([\d.]+)/);
        var safari = webkit && ua.match(/Mobile\//) && !chrome;
        var webview = ua.match(/(iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/) && !chrome;
        var ie = ua.match(/MSIE\s([\d.]+)/);

        // Todo: clean this up with a better OS/browser seperation:
        // - discern (more) between multiple browsers on android
        // - decide if kindle fire in silk mode is android or not
        // - Firefox on Android doesn't specify the Android version
        // - possibly devide in os, device and browser hashes

        if (browser.webkit = !!webkit) browser.version = webkit[1];

        if (android) os.android = true, os.version = android[2];
        if (iphone && !ipod) os.ios = os.iphone = true, os.version = iphone[2].replace(/_/g, '.');
        if (ipad) os.ios = os.ipad = true, os.version = ipad[2].replace(/_/g, '.');
        if (ipod) os.ios = os.ipod = true, os.version = ipod[3] ? ipod[3].replace(/_/g, '.') : null;
        if (webos) os.webos = true, os.version = webos[2];
        if (touchpad) os.touchpad = true;
        if (blackberry) os.blackberry = true, os.version = blackberry[2];
        if (bb10) os.bb10 = true, os.version = bb10[2];
        if (rimtabletos) os.rimtabletos = true, os.version = rimtabletos[2];
        if (playbook) browser.playbook = true;
        if (kindle) os.kindle = true, os.version = kindle[1];
        if (silk) browser.silk = true, browser.version = silk[1];
        if (!silk && os.android && ua.match(/Kindle Fire/)) browser.silk = true;
        if (chrome) browser.chrome = true, browser.version = chrome[1];
        if (firefox) browser.firefox = true, browser.version = firefox[1];
        if (ie) browser.ie = true, browser.version = ie[1];
        if (safari && (ua.match(/Safari/) || !!os.ios)) browser.safari = true;
        if (webview) browser.webview = true;
        if (ie) browser.ie = true, browser.version = ie[1];

        os.tablet = !!(ipad || playbook || (android && !ua.match(/Mobile/)) ||
            (firefox && ua.match(/Tablet/)) || (ie && !ua.match(/Phone/) && ua.match(/Touch/)));
        os.phone  = !!(!os.tablet && !os.ipod && (android || iphone || webos || blackberry || bb10 ||
            (chrome && ua.match(/Android/)) || (chrome && ua.match(/CriOS\/([\d.]+)/)) ||
            (firefox && ua.match(/Mobile/)) || (ie && ua.match(/Touch/))));

        return {
            browser: browser,
            os: os,
            // 原生canvas支持，改极端点了
            // canvasSupported : !(browser.ie && parseFloat(browser.version) < 9)
            canvasSupported : document.createElement('canvas').getContext ? true : false
        };
    }

    return detect(navigator.userAgent);
});
define('zrender/tool/util', ['require', '../dep/excanvas'], function (require) {

        var ArrayProto = Array.prototype;
        var nativeForEach = ArrayProto.forEach;
        var nativeMap = ArrayProto.map;
        var nativeFilter = ArrayProto.filter;

        // 用于处理merge时无法遍历Date等对象的问题
        var BUILTIN_OBJECT = {
            '[object Function]': 1,
            '[object RegExp]': 1,
            '[object Date]': 1,
            '[object Error]': 1,
            '[object CanvasGradient]': 1
        };

        var objToString = Object.prototype.toString;

        function isDom(obj) {
            return obj && obj.nodeType === 1
                   && typeof(obj.nodeName) == 'string';
        }

        /**
         * 对一个object进行深度拷贝
         * @memberOf module:zrender/tool/util
         * @param {*} source 需要进行拷贝的对象
         * @return {*} 拷贝后的新对象
         */
        function clone(source) {
            if (typeof source == 'object' && source !== null) {
                var result = source;
                if (source instanceof Array) {
                    result = [];
                    for (var i = 0, len = source.length; i < len; i++) {
                        result[i] = clone(source[i]);
                    }
                }
                else if (
                    !BUILTIN_OBJECT[objToString.call(source)]
                    // 是否为 dom 对象
                    && !isDom(source)
                ) {
                    result = {};
                    for (var key in source) {
                        if (source.hasOwnProperty(key)) {
                            result[key] = clone(source[key]);
                        }
                    }
                }

                return result;
            }

            return source;
        }

        function mergeItem(target, source, key, overwrite) {
            if (source.hasOwnProperty(key)) {
                var targetProp = target[key];
                if (typeof targetProp == 'object'
                    && !BUILTIN_OBJECT[objToString.call(targetProp)]
                    // 是否为 dom 对象
                    && !isDom(targetProp)
                ) {
                    // 如果需要递归覆盖，就递归调用merge
                    merge(
                        target[key],
                        source[key],
                        overwrite
                    );
                }
                else if (overwrite || !(key in target)) {
                    // 否则只处理overwrite为true，或者在目标对象中没有此属性的情况
                    target[key] = source[key];
                }
            }
        }

        /**
         * 合并源对象的属性到目标对象
         * @memberOf module:zrender/tool/util
         * @param {*} target 目标对象
         * @param {*} source 源对象
         * @param {boolean} overwrite 是否覆盖
         */
        function merge(target, source, overwrite) {
            for (var i in source) {
                mergeItem(target, source, i, overwrite);
            }
            
            return target;
        }

        var _ctx;

        function getContext() {
            if (!_ctx) {
                require('../dep/excanvas');
                /* jshint ignore:start */
                if (window['G_vmlCanvasManager']) {
                    var _div = document.createElement('div');
                    _div.style.position = 'absolute';
                    _div.style.top = '-1000px';
                    document.body.appendChild(_div);

                    _ctx = G_vmlCanvasManager.initElement(_div)
                               .getContext('2d');
                }
                else {
                    _ctx = document.createElement('canvas').getContext('2d');
                }
                /* jshint ignore:end */
            }
            return _ctx;
        }

        /**
         * @memberOf module:zrender/tool/util
         * @param {Array} array
         * @param {*} value
         */
        function indexOf(array, value) {
            if (array.indexOf) {
                return array.indexOf(value);
            }
            for (var i = 0, len = array.length; i < len; i++) {
                if (array[i] === value) {
                    return i;
                }
            }
            return -1;
        }

        /**
         * 构造类继承关系
         * @memberOf module:zrender/tool/util
         * @param {Function} clazz 源类
         * @param {Function} baseClazz 基类
         */
        function inherits(clazz, baseClazz) {
            var clazzPrototype = clazz.prototype;
            function F() {}
            F.prototype = baseClazz.prototype;
            clazz.prototype = new F();

            for (var prop in clazzPrototype) {
                clazz.prototype[prop] = clazzPrototype[prop];
            }
            clazz.constructor = clazz;
        }

        /**
         * 数组或对象遍历
         * @memberOf module:zrender/tool/util
         * @param {Object|Array} obj
         * @param {Function} cb
         * @param {*} [context]
         */
        function each(obj, cb, context) {
            if (!(obj && cb)) {
                return;
            }
            if (obj.forEach && obj.forEach === nativeForEach) {
                obj.forEach(cb, context);
            }
            else if (obj.length === +obj.length) {
                for (var i = 0, len = obj.length; i < len; i++) {
                    cb.call(context, obj[i], i, obj);
                }
            }
            else {
                for (var key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        cb.call(context, obj[key], key, obj);
                    }
                }
            }
        }

        /**
         * 数组映射
         * @memberOf module:zrender/tool/util
         * @param {Array} obj
         * @param {Function} cb
         * @param {*} [context]
         * @return {Array}
         */
        function map(obj, cb, context) {
            if (!(obj && cb)) {
                return;
            }
            if (obj.map && obj.map === nativeMap) {
                return obj.map(cb, context);
            }
            else {
                var result = [];
                for (var i = 0, len = obj.length; i < len; i++) {
                    result.push(cb.call(context, obj[i], i, obj));
                }
                return result;
            }
        }

        /**
         * 数组过滤
         * @memberOf module:zrender/tool/util
         * @param {Array} obj
         * @param {Function} cb
         * @param {*} [context]
         * @return {Array}
         */
        function filter(obj, cb, context) {
            if (!(obj && cb)) {
                return;
            }
            if (obj.filter && obj.filter === nativeFilter) {
                return obj.filter(cb, context);
            }
            else {
                var result = [];
                for (var i = 0, len = obj.length; i < len; i++) {
                    if (cb.call(context, obj[i], i, obj)) {
                        result.push(obj[i]);
                    }
                }
                return result;
            }
        }

        function bind(func, context) {
            
            return function () {
                func.apply(context, arguments);
            }
        }

        return {
            inherits: inherits,
            clone: clone,
            merge: merge,
            getContext: getContext,
            indexOf: indexOf,
            each: each,
            map: map,
            filter: filter,
            bind: bind
        };
    });
define('zrender/config', [], function () {
    /**
     * config默认配置项
     * @exports zrender/config
     * @author Kener (@Kener-林峰, kener.linfeng@gmail.com)
     */
    var config = {
        /**
         * @namespace module:zrender/config.EVENT
         */
        EVENT : {
            /**
             * 窗口大小变化
             * @type {string}
             */
            RESIZE : 'resize',
            /**
             * 鼠标按钮被（手指）按下，事件对象是：目标图形元素或空
             * @type {string}
             */
            CLICK : 'click',
            /**
             * 双击事件
             * @type {string}
             */
            DBLCLICK : 'dblclick',
            /**
             * 鼠标滚轮变化，事件对象是：目标图形元素或空
             * @type {string}
             */
            MOUSEWHEEL : 'mousewheel',
            /**
             * 鼠标（手指）被移动，事件对象是：目标图形元素或空
             * @type {string}
             */
            MOUSEMOVE : 'mousemove',
            /**
             * 鼠标移到某图形元素之上，事件对象是：目标图形元素
             * @type {string}
             */
            MOUSEOVER : 'mouseover',
            /**
             * 鼠标从某图形元素移开，事件对象是：目标图形元素
             * @type {string}
             */
            MOUSEOUT : 'mouseout',
            /**
             * 鼠标按钮（手指）被按下，事件对象是：目标图形元素或空
             * @type {string}
             */
            MOUSEDOWN : 'mousedown',
            /**
             * 鼠标按键（手指）被松开，事件对象是：目标图形元素或空
             * @type {string}
             */
            MOUSEUP : 'mouseup',
            /**
             * 全局离开，MOUSEOUT触发比较频繁，一次离开优化绑定
             * @type {string}
             */
            GLOBALOUT : 'globalout',    // 

            // 一次成功元素拖拽的行为事件过程是：
            // dragstart > dragenter > dragover [> dragleave] > drop > dragend
            /**
             * 开始拖拽时触发，事件对象是：被拖拽图形元素
             * @type {string}
             */
            DRAGSTART : 'dragstart',
            /**
             * 拖拽完毕时触发（在drop之后触发），事件对象是：被拖拽图形元素
             * @type {string}
             */
            DRAGEND : 'dragend',
            /**
             * 拖拽图形元素进入目标图形元素时触发，事件对象是：目标图形元素
             * @type {string}
             */
            DRAGENTER : 'dragenter',
            /**
             * 拖拽图形元素在目标图形元素上移动时触发，事件对象是：目标图形元素
             * @type {string}
             */
            DRAGOVER : 'dragover',
            /**
             * 拖拽图形元素离开目标图形元素时触发，事件对象是：目标图形元素
             * @type {string}
             */
            DRAGLEAVE : 'dragleave',
            /**
             * 拖拽图形元素放在目标图形元素内时触发，事件对象是：目标图形元素
             * @type {string}
             */
            DROP : 'drop',
            /**
             * touch end - start < delay is click
             * @type {number}
             */
            touchClickDelay : 300
        },

        elementClassName: 'zr-element',

        // 是否异常捕获
        catchBrushException: false,

        /**
         * debug日志选项：catchBrushException为true下有效
         * 0 : 不生成debug数据，发布用
         * 1 : 异常抛出，调试用
         * 2 : 控制台输出，调试用
         */
        debugMode: 0,

        // retina 屏幕优化
        devicePixelRatio: Math.max(window.devicePixelRatio || 1, 1)
    };
    return config;
});
define('zrender/tool/event', ['require', '../mixin/Eventful'], function (require) {

        'use strict';

        var Eventful = require('../mixin/Eventful');

        /**
        * 提取鼠标（手指）x坐标
        * @memberOf module:zrender/tool/event
        * @param  {Event} e 事件.
        * @return {number} 鼠标（手指）x坐标.
        */
        function getX(e) {
            return typeof e.zrenderX != 'undefined' && e.zrenderX
                   || typeof e.offsetX != 'undefined' && e.offsetX
                   || typeof e.layerX != 'undefined' && e.layerX
                   || typeof e.clientX != 'undefined' && e.clientX;
        }

        /**
        * 提取鼠标y坐标
        * @memberOf module:zrender/tool/event
        * @param  {Event} e 事件.
        * @return {number} 鼠标（手指）y坐标.
        */
        function getY(e) {
            return typeof e.zrenderY != 'undefined' && e.zrenderY
                   || typeof e.offsetY != 'undefined' && e.offsetY
                   || typeof e.layerY != 'undefined' && e.layerY
                   || typeof e.clientY != 'undefined' && e.clientY;
        }

        /**
        * 提取鼠标滚轮变化
        * @memberOf module:zrender/tool/event
        * @param  {Event} e 事件.
        * @return {number} 滚轮变化，正值说明滚轮是向上滚动，如果是负值说明滚轮是向下滚动
        */
        function getDelta(e) {
            return typeof e.zrenderDelta != 'undefined' && e.zrenderDelta
                   || typeof e.wheelDelta != 'undefined' && e.wheelDelta
                   || typeof e.detail != 'undefined' && -e.detail;
        }

        /**
         * 停止冒泡和阻止默认行为
         * @memberOf module:zrender/tool/event
         * @method
         * @param {Event} e : event对象
         */
        var stop = typeof window.addEventListener === 'function'
            ? function (e) {
                e.preventDefault();
                e.stopPropagation();
                e.cancelBubble = true;
            }
            : function (e) {
                e.returnValue = false;
                e.cancelBubble = true;
            };
        
        return {
            getX : getX,
            getY : getY,
            getDelta : getDelta,
            stop : stop,
            // 做向上兼容
            Dispatcher : Eventful
        };
    });
define('zrender/zrender', ['require', './dep/excanvas', './tool/util', './tool/log', './tool/guid', './Handler', './Painter', './Storage', './animation/Animation', './tool/env'], function (require) {
        /*
         * HTML5 Canvas for Internet Explorer!
         * Modern browsers like Firefox, Safari, Chrome and Opera support
         * the HTML5 canvas tag to allow 2D command-based drawing.
         * ExplorerCanvas brings the same functionality to Internet Explorer.
         * To use, web developers only need to include a single script tag
         * in their existing web pages.
         *
         * https://code.google.com/p/explorercanvas/
         * http://explorercanvas.googlecode.com/svn/trunk/excanvas.js
         */
        // 核心代码会生成一个全局变量 G_vmlCanvasManager，模块改造后借用于快速判断canvas支持
        require('./dep/excanvas');

        var util = require('./tool/util');
        var log = require('./tool/log');
        var guid = require('./tool/guid');

        var Handler = require('./Handler');
        var Painter = require('./Painter');
        var Storage = require('./Storage');
        var Animation = require('./animation/Animation');

        var _instances = {};    // ZRender实例map索引

        /**
         * @exports zrender
         * @author Kener (@Kener-林峰, kener.linfeng@gmail.com)
         *         pissang (https://www.github.com/pissang)
         */
        var zrender = {};
        /**
         * @type {string}
         */
        zrender.version = '2.1.0';

        /**
         * 创建zrender实例
         *
         * @param {HTMLElement} dom 绘图容器
         * @return {module:zrender/ZRender} ZRender实例
         */
        // 不让外部直接new ZRender实例，为啥？
        // 不为啥，提供全局可控同时减少全局污染和降低命名冲突的风险！
        zrender.init = function(dom) {
            var zr = new ZRender(guid(), dom);
            _instances[zr.id] = zr;
            return zr;
        };

        /**
         * zrender实例销毁
         * @param {module:zrender/ZRender} zr ZRender对象，不传则销毁全部
         */
        // 在_instances里的索引也会删除了
        // 管生就得管死，可以通过zrender.dispose(zr)销毁指定ZRender实例
        // 当然也可以直接zr.dispose()自己销毁
        zrender.dispose = function (zr) {
            if (zr) {
                zr.dispose();
            }
            else {
                for (var key in _instances) {
                    _instances[key].dispose();
                }
                _instances = {};
            }

            return zrender;
        };

        /**
         * 获取zrender实例
         * @param {string} id ZRender对象索引
         * @return {module:zrender/ZRender}
         */
        zrender.getInstance = function (id) {
            return _instances[id];
        };

        /**
         * 删除zrender实例，ZRender实例dispose时会调用，
         * 删除后getInstance则返回undefined
         * ps: 仅是删除，删除的实例不代表已经dispose了~~
         *     这是一个摆脱全局zrender.dispose()自动销毁的后门，
         *     take care of yourself~
         *
         * @param {string} id ZRender对象索引
         */
        zrender.delInstance = function (id) {
            delete _instances[id];
            return zrender;
        };

        function getFrameCallback(zrInstance) {
            return function () {
                if (zrInstance._needsRefreshNextFrame) {
                    zrInstance.refresh();
                }
            };
        }

        /**
         * @module zrender/ZRender
         */
        /**
         * ZRender接口类，对外可用的所有接口都在这里
         * 非get接口统一返回支持链式调用
         *
         * @constructor
         * @alias module:zrender/ZRender
         * @param {string} id 唯一标识
         * @param {HTMLElement} dom dom对象，不帮你做document.getElementById
         * @return {ZRender} ZRender实例
         */
        var ZRender = function(id, dom) {
            /**
             * 实例 id
             * @type {string}
             */
            this.id = id;
            this.env = require('./tool/env');

            this.storage = new Storage();
            this.painter = new Painter(dom, this.storage);
            this.handler = new Handler(dom, this.storage, this.painter);

            /**
             * @type {module:zrender/animation/Animation}
             */
            this.animation = new Animation({
                stage: {
                    update: getFrameCallback(this)
                }
            });
            this.animation.start();

            var self = this;
            this.painter.refreshNextFrame = function () {
                self.refreshNextFrame();
            };

            this._needsRefreshNextFrame = false;

            // 修改 storage.delFromMap, 每次删除元素之前删除动画
            // FIXME 有点ugly
            var self = this;
            var storage = this.storage;
            var oldDelFromMap = storage.delFromMap;
            storage.delFromMap = function (elId) {
                var el = storage.get(elId);
                self.stopAnimation(el);
                oldDelFromMap.call(storage, elId);
            };
        };

        /**
         * 获取实例唯一标识
         * @return {string}
         */
        ZRender.prototype.getId = function () {
            return this.id;
        };

        /**
         * 添加图形形状到根节点
         * @deprecated Use {@link module:zrender/ZRender.prototype.addElement} instead
         * @param {module:zrender/shape/Base} shape 形状对象，可用属性全集，详见各shape
         */
        ZRender.prototype.addShape = function (shape) {
            this.addElement(shape);
            return this;
        };

        /**
         * 添加组到根节点
         * @deprecated Use {@link module:zrender/ZRender.prototype.addElement} instead
         * @param {module:zrender/Group} group
         */
        ZRender.prototype.addGroup = function(group) {
            this.addElement(group);
            return this;
        };

        /**
         * 从根节点删除图形形状
         * @deprecated Use {@link module:zrender/ZRender.prototype.delElement} instead
         * @param {string} shapeId 形状对象唯一标识
         */
        ZRender.prototype.delShape = function (shapeId) {
            this.delElement(shapeId);
            return this;
        };

        /**
         * 从根节点删除组
         * @deprecated Use {@link module:zrender/ZRender.prototype.delElement} instead
         * @param {string} groupId
         */
        ZRender.prototype.delGroup = function (groupId) {
            this.delElement(groupId);
            return this;
        };

        /**
         * 修改图形形状
         * @deprecated Use {@link module:zrender/ZRender.prototype.modElement} instead
         * @param {string} shapeId 形状对象唯一标识
         * @param {Object} shape 形状对象
         */
        ZRender.prototype.modShape = function (shapeId, shape) {
            this.modElement(shapeId, shape);
            return this;
        };

        /**
         * 修改组
         * @deprecated Use {@link module:zrender/ZRender.prototype.modElement} instead
         * @param {string} groupId
         * @param {Object} group
         */
        ZRender.prototype.modGroup = function (groupId, group) {
            this.modElement(groupId, group);
            return this;
        };

        /**
         * 添加元素
         * @param  {string|module:zrender/Group|module:zrender/shape/Base} el
         */
        ZRender.prototype.addElement = function (el) {
            this.storage.addRoot(el);
            this._needsRefreshNextFrame = true;
            return this;
        };

        /**
         * 删除元素
         * @param  {string|module:zrender/Group|module:zrender/shape/Base} el
         */
        ZRender.prototype.delElement = function (el) {
            this.storage.delRoot(el);
            this._needsRefreshNextFrame = true;
            return this;
        };

        /**
         * 修改元素, 主要标记图形或者组需要在下一帧刷新。
         * 第二个参数为需要覆盖到元素上的参数，不建议使用。
         *
         * @example
         *     el.style.color = 'red';
         *     el.position = [10, 10];
         *     zr.modElement(el);
         * @param  {string|module:zrender/Group|module:zrender/shape/Base} el
         * @param {Object} [params]
         */
        ZRender.prototype.modElement = function (el, params) {
            this.storage.mod(el, params);
            this._needsRefreshNextFrame = true;
            return this;
        };

        /**
         * 修改指定zlevel的绘制配置项
         * 
         * @param {string} zLevel
         * @param {Object} config 配置对象
         * @param {string} [config.clearColor=0] 每次清空画布的颜色
         * @param {string} [config.motionBlur=false] 是否开启动态模糊
         * @param {number} [config.lastFrameAlpha=0.7]
         *                 在开启动态模糊的时候使用，与上一帧混合的alpha值，值越大尾迹越明显
         * @param {Array.<number>} [config.position] 层的平移
         * @param {Array.<number>} [config.rotation] 层的旋转
         * @param {Array.<number>} [config.scale] 层的缩放
         * @param {boolean} [config.zoomable=false] 层是否支持鼠标缩放操作
         * @param {boolean} [config.panable=false] 层是否支持鼠标平移操作
         */
        ZRender.prototype.modLayer = function (zLevel, config) {
            this.painter.modLayer(zLevel, config);
            this._needsRefreshNextFrame = true;
            return this;
        };

        /**
         * 添加额外高亮层显示，仅提供添加方法，每次刷新后高亮层图形均被清空
         * 
         * @param {Object} shape 形状对象
         */
        ZRender.prototype.addHoverShape = function (shape) {
            this.storage.addHover(shape);
            return this;
        };

        /**
         * 渲染
         * 
         * @param {Function} callback  渲染结束后回调函数
         */
        ZRender.prototype.render = function (callback) {
            this.painter.render(callback);
            this._needsRefreshNextFrame = false;
            return this;
        };

        /**
         * 视图更新
         * 
         * @param {Function} callback  视图更新后回调函数
         */
        ZRender.prototype.refresh = function (callback) {
            this.painter.refresh(callback);
            this._needsRefreshNextFrame = false;
            return this;
        };

        /**
         * 标记视图在浏览器下一帧需要绘制
         */
        ZRender.prototype.refreshNextFrame = function() {
            this._needsRefreshNextFrame = true;
            return this;
        };
        
        /**
         * 绘制高亮层
         * @param {Function} callback  视图更新后回调函数
         */
        ZRender.prototype.refreshHover = function (callback) {
            this.painter.refreshHover(callback);
            return this;
        };

        /**
         * 视图更新
         * 
         * @param {Array.<module:zrender/shape/Base>} shapeList 需要更新的图形列表
         * @param {Function} callback  视图更新后回调函数
         */
        ZRender.prototype.refreshShapes = function (shapeList, callback) {
            this.painter.refreshShapes(shapeList, callback);
            return this;
        };

        /**
         * 调整视图大小
         */
        ZRender.prototype.resize = function() {
            this.painter.resize();
            return this;
        };

        /**
         * 动画
         * 
         * @param {string|module:zrender/Group|module:zrender/shape/Base} el 动画对象
         * @param {string} path 需要添加动画的属性获取路径，可以通过a.b.c来获取深层的属性
         * @param {boolean} [loop] 动画是否循环
         * @return {module:zrender/animation/Animation~Animator}
         * @example:
         *     zr.animate(circle.id, 'style', false)
         *         .when(1000, {x: 10} )
         *         .done(function(){ // Animation done })
         *         .start()
         */
        ZRender.prototype.animate = function (el, path, loop) {
            var self = this;

            if (typeof(el) === 'string') {
                el = this.storage.get(el);
            }
            if (el) {
                var target;
                if (path) {
                    var pathSplitted = path.split('.');
                    var prop = el;
                    for (var i = 0, l = pathSplitted.length; i < l; i++) {
                        if (!prop) {
                            continue;
                        }
                        prop = prop[pathSplitted[i]];
                    }
                    if (prop) {
                        target = prop;
                    }
                }
                else {
                    target = el;
                }

                if (!target) {
                    log(
                        'Property "'
                        + path
                        + '" is not existed in element '
                        + el.id
                    );
                    return;
                }

                if (el.__animators == null) {
                    // 正在进行的动画记数
                    el.__animators = [];
                }
                var animators = el.__animators;

                var animator = this.animation.animate(target, { loop: loop })
                    .during(function () {
                        self.modShape(el);
                    })
                    .done(function () {
                        var idx = util.indexOf(el.__animators, animator);
                        if (idx >= 0) {
                            animators.splice(idx, 1);
                        }
                    });
                animators.push(animator);

                return animator;
            }
            else {
                log('Element not existed');
            }
        };

        /**
         * 停止动画对象的动画
         * @param  {string|module:zrender/Group|module:zrender/shape/Base} el
         */
        ZRender.prototype.stopAnimation = function (el) {
            if (el.__animators) {
                var animators = el.__animators;
                var len = animators.length;
                for (var i = 0; i < len; i++) {
                    animators[i].stop();
                }
                animators.length = 0;
            }
            return this;
        };

        /**
         * 停止所有动画
         */
        ZRender.prototype.clearAnimation = function () {
            this.animation.clear();
            return this;
        };

        /**
         * loading显示
         * 
         * @param {Object=} loadingEffect loading效果对象
         */
        ZRender.prototype.showLoading = function (loadingEffect) {
            this.painter.showLoading(loadingEffect);
            return this;
        };

        /**
         * loading结束
         */
        ZRender.prototype.hideLoading = function () {
            this.painter.hideLoading();
            return this;
        };

        /**
         * 获取视图宽度
         */
        ZRender.prototype.getWidth = function() {
            return this.painter.getWidth();
        };

        /**
         * 获取视图高度
         */
        ZRender.prototype.getHeight = function() {
            return this.painter.getHeight();
        };

        /**
         * 图像导出
         * @param {string} type
         * @param {string} [backgroundColor='#fff'] 背景色
         * @return {string} 图片的Base64 url
         */
        ZRender.prototype.toDataURL = function(type, backgroundColor, args) {
            return this.painter.toDataURL(type, backgroundColor, args);
        };

        /**
         * 将常规shape转成image shape
         * @param {module:zrender/shape/Base} e
         * @param {number} width
         * @param {number} height
         */
        ZRender.prototype.shapeToImage = function(e, width, height) {
            var id = guid();
            return this.painter.shapeToImage(id, e, width, height);
        };

        /**
         * 事件绑定
         * 
         * @param {string} eventName 事件名称
         * @param {Function} eventHandler 响应函数
         * @param {Object} [context] 响应函数
         */
        ZRender.prototype.on = function(eventName, eventHandler, context) {
            this.handler.on(eventName, eventHandler, context);
            return this;
        };

        /**
         * 事件解绑定，参数为空则解绑所有自定义事件
         * 
         * @param {string} eventName 事件名称
         * @param {Function} eventHandler 响应函数
         */
        ZRender.prototype.un = function(eventName, eventHandler) {
            this.handler.un(eventName, eventHandler);
            return this;
        };
        
        /**
         * 事件触发
         * 
         * @param {string} eventName 事件名称，resize，hover，drag，etc
         * @param {event=} event event dom事件对象
         */
        ZRender.prototype.trigger = function (eventName, event) {
            this.handler.trigger(eventName, event);
            return this;
        };
        

        /**
         * 清除当前ZRender下所有类图的数据和显示，clear后MVC和已绑定事件均还存在在，ZRender可用
         */
        ZRender.prototype.clear = function () {
            this.storage.delRoot();
            this.painter.clear();
            return this;
        };

        /**
         * 释放当前ZR实例（删除包括dom，数据、显示和事件绑定），dispose后ZR不可用
         */
        ZRender.prototype.dispose = function () {
            this.animation.stop();
            
            this.clear();
            this.storage.dispose();
            this.painter.dispose();
            this.handler.dispose();

            this.animation = 
            this.storage = 
            this.painter = 
            this.handler = null;

            // 释放后告诉全局删除对自己的索引，没想到啥好方法
            zrender.delInstance(this.id);
        };

        return zrender;
    });
define('echarts/component/toolbox', ['require', './base', 'zrender/shape/Line', 'zrender/shape/Image', 'zrender/shape/Rectangle', '../util/shape/Icon', '../config', 'zrender/tool/util', 'zrender/config', 'zrender/tool/event', './dataView', '../component'], function (require) {
    var Base = require('./base');
    
    // 图形依赖
    var LineShape = require('zrender/shape/Line');
    var ImageShape = require('zrender/shape/Image');
    var RectangleShape = require('zrender/shape/Rectangle');
    var IconShape = require('../util/shape/Icon');
    
    var ecConfig = require('../config');
    ecConfig.toolbox = {
        zlevel: 0,                  // 一级层叠
        z: 6,                       // 二级层叠
        show: false,
        orient: 'horizontal',      // 布局方式，默认为水平布局，可选为：
                                   // 'horizontal' ¦ 'vertical'
        x: 'right',                // 水平安放位置，默认为全图右对齐，可选为：
                                   // 'center' ¦ 'left' ¦ 'right'
                                   // ¦ {number}（x坐标，单位px）
        y: 'top',                  // 垂直安放位置，默认为全图顶端，可选为：
                                   // 'top' ¦ 'bottom' ¦ 'center'
                                   // ¦ {number}（y坐标，单位px）
        color: ['#1e90ff','#22bb22','#4b0082','#d2691e'],
        disableColor: '#ddd',
        effectiveColor: 'red',
        backgroundColor: 'rgba(0,0,0,0)', // 工具箱背景颜色
        borderColor: '#ccc',       // 工具箱边框颜色
        borderWidth: 0,            // 工具箱边框线宽，单位px，默认为0（无边框）
        padding: 5,                // 工具箱内边距，单位px，默认各方向内边距为5，
                                   // 接受数组分别设定上右下左边距，同css
        itemGap: 10,               // 各个item之间的间隔，单位px，默认为10，
                                   // 横向布局时为水平间隔，纵向布局时为纵向间隔
        itemSize: 16,              // 工具箱图形宽度
        showTitle: true,
        // textStyle: {},
        feature: {
            mark: {
                show: false,
                title: {
                    mark: '辅助线开关',
                    markUndo: '删除辅助线',
                    markClear: '清空辅助线'
                },
                lineStyle: {
                    width: 1,
                    color: '#1e90ff',
                    type: 'dashed'
                }
            },
            dataZoom: {
                show: false,
                title: {
                    dataZoom: '区域缩放',
                    dataZoomReset: '区域缩放后退'
                }
            },
            dataView: {
                show: false,
                title: '数据视图',
                readOnly: false,
                lang: ['数据视图', '关闭', '刷新']
            },
            magicType: {
                show: false,
                title: {
                    line: '折线图切换',
                    bar: '柱形图切换',
                    stack: '堆积',
                    tiled: '平铺',
                    force: '力导向布局图切换',
                    chord: '和弦图切换',
                    pie: '饼图切换',
                    funnel: '漏斗图切换'
                },
                /*
                option: {
                    line: {},
                    bar: {},
                    stack: {},
                    tiled: {},
                    force: {},
                    chord: {},
                    pie: {},
                    funnel: {}
                },
                */
                type: [] // 'line', 'bar', 'stack', 'tiled', 'force', 'chord', 'pie', 'funnel'
            },
            restore: {
                show: false,
                title: '还原'
            },
            saveAsImage: {
                show: false,
                title: '保存为图片',
                type: 'png',
                lang: ['点击保存'] 
            }
        }
    };

    var zrUtil = require('zrender/tool/util');
    var zrConfig = require('zrender/config');
    var zrEvent = require('zrender/tool/event');
    
    var _MAGICTYPE_STACK = 'stack';
    var _MAGICTYPE_TILED = 'tiled';
        
    /**
     * 构造函数
     * @param {Object} messageCenter echart消息中心
     * @param {ZRender} zr zrender实例
     * @param {HtmlElement} dom 目标对象
     * @param {ECharts} myChart 当前图表实例
     */
    function Toolbox(ecTheme, messageCenter, zr, option, myChart) {
        Base.call(this, ecTheme, messageCenter, zr, option, myChart);

        this.dom = myChart.dom;
        
        this._magicType = {};
        this._magicMap = {};
        this._isSilence = false;
        
        this._iconList;
        this._iconShapeMap = {};
        //this._itemGroupLocation;
        this._featureTitle = {};             // 文字
        this._featureIcon = {};              // 图标
        this._featureColor = {};             // 颜色
        this._featureOption = {};
        this._enableColor = 'red';
        this._disableColor = '#ccc';
        // this._markStart;
        // this._marking;
        // this._markShape;
        // this._zoomStart;
        // this._zooming;
        // this._zoomShape;
        // this._zoomQueue;
        // this._dataView;
        this._markShapeList = [];
        var self = this;
        self._onMark = function (param) {
            self.__onMark(param);
        };
        self._onMarkUndo = function (param) {
            self.__onMarkUndo(param);
        };
        self._onMarkClear = function (param) {
            self.__onMarkClear(param);
        };
        self._onDataZoom = function (param) {
            self.__onDataZoom(param);
        };
        self._onDataZoomReset = function (param) {
            self.__onDataZoomReset(param);
        };
        self._onDataView = function (param) {
            self.__onDataView(param);
        };
        self._onRestore = function (param) {
            self.__onRestore(param);
        };
        self._onSaveAsImage = function (param) {
            self.__onSaveAsImage(param);
        };
        self._onMagicType = function (param) {
            self.__onMagicType(param);
        };
        self._onCustomHandler = function (param) {
            self.__onCustomHandler(param);
        };
        self._onmousemove = function (param) {
            return self.__onmousemove(param);
        };

        self._onmousedown = function (param) {
            return self.__onmousedown(param);
        };
        
        self._onmouseup = function (param) {
            return self.__onmouseup(param);
        };
        
        self._onclick = function (param) {
            return self.__onclick(param);
        };
    }

    Toolbox.prototype = {
        type: ecConfig.COMPONENT_TYPE_TOOLBOX,
        _buildShape: function () {
            this._iconList = [];
            var toolboxOption = this.option.toolbox;
            this._enableColor = toolboxOption.effectiveColor;
            this._disableColor = toolboxOption.disableColor;
            var feature = toolboxOption.feature;
            var iconName = [];
            for (var key in feature){
                if (feature[key].show) {
                    switch (key) {
                        case 'mark' :
                            iconName.push({ key: key, name: 'mark' });
                            iconName.push({ key: key, name: 'markUndo' });
                            iconName.push({ key: key, name: 'markClear' });
                            break;
                        case 'magicType' :
                            for (var i = 0, l = feature[key].type.length; i < l; i++) {
                                feature[key].title[feature[key].type[i] + 'Chart']
                                    = feature[key].title[feature[key].type[i]];
                                if (feature[key].option) {
                                    feature[key].option[feature[key].type[i] + 'Chart']
                                        = feature[key].option[feature[key].type[i]];
                                }
                                iconName.push({ key: key, name: feature[key].type[i] + 'Chart' });
                            }
                            break;
                        case 'dataZoom' :
                            iconName.push({ key: key, name: 'dataZoom' });
                            iconName.push({ key: key, name: 'dataZoomReset' });
                            break;
                        case 'saveAsImage' :
                            if (this.canvasSupported) {
                                iconName.push({ key: key, name: 'saveAsImage' });
                            }
                            break;
                        default :
                            iconName.push({ key: key, name: key });
                            break;
                    }
                }
            }
            if (iconName.length > 0) {
                var name;
                var key;
                for (var i = 0, l = iconName.length; i < l; i++) {
                    name = iconName[i].name;
                    key = iconName[i].key;
                    this._iconList.push(name);
                    this._featureTitle[name] = feature[key].title[name] || feature[key].title;
                    if (feature[key].icon) {
                        this._featureIcon[name] = feature[key].icon[name] || feature[key].icon;
                    }
                    if (feature[key].color) {
                        this._featureColor[name] = feature[key].color[name] || feature[key].color;
                    }
                    if (feature[key].option) {
                        this._featureOption[name] = feature[key].option[name] 
                                                    || feature[key].option;
                    }
                }
                this._itemGroupLocation = this._getItemGroupLocation();

                this._buildBackground();
                this._buildItem();

                for (var i = 0, l = this.shapeList.length; i < l; i++) {
                    this.zr.addShape(this.shapeList[i]);
                }
                if (this._iconShapeMap['mark']) {
                    this._iconDisable(this._iconShapeMap['markUndo']);
                    this._iconDisable(this._iconShapeMap['markClear']);
                }
                if (this._iconShapeMap['dataZoomReset'] && this._zoomQueue.length === 0) {
                    this._iconDisable(this._iconShapeMap['dataZoomReset']);
                }
            }
        },

        /**
         * 构建所有图例元素
         */
        _buildItem: function () {
            var toolboxOption = this.option.toolbox;
            var iconLength = this._iconList.length;
            var lastX = this._itemGroupLocation.x;
            var lastY = this._itemGroupLocation.y;
            var itemSize = toolboxOption.itemSize;
            var itemGap = toolboxOption.itemGap;
            var itemShape;

            var color = toolboxOption.color instanceof Array
                        ? toolboxOption.color : [toolboxOption.color];
            
            var textFont = this.getFont(toolboxOption.textStyle);
            var textPosition;
            var textAlign;
            var textBaseline;
            if (toolboxOption.orient === 'horizontal') {
                textPosition = this._itemGroupLocation.y / this.zr.getHeight() < 0.5
                               ? 'bottom' : 'top';
                textAlign = this._itemGroupLocation.x / this.zr.getWidth() < 0.5
                            ? 'left' : 'right';
                textBaseline = this._itemGroupLocation.y / this.zr.getHeight() < 0.5
                               ? 'top' : 'bottom';
            }
            else {
                textPosition = this._itemGroupLocation.x / this.zr.getWidth() < 0.5
                               ? 'right' : 'left';
            }
            
           this._iconShapeMap = {};
           var self = this;

            for (var i = 0; i < iconLength; i++) {
                // 图形
                itemShape = {
                    type: 'icon',
                    zlevel: this.getZlevelBase(),
                    z: this.getZBase(),
                    style: {
                        x: lastX,
                        y: lastY,
                        width: itemSize,
                        height: itemSize,
                        iconType: this._iconList[i],
                        lineWidth: 1,
                        strokeColor: this._featureColor[this._iconList[i]] 
                                     || color[i % color.length],
                        brushType: 'stroke'
                    },
                    highlightStyle: {
                        lineWidth: 1,
                        text: toolboxOption.showTitle 
                              ? this._featureTitle[this._iconList[i]]
                              : undefined,
                        textFont: textFont,
                        textPosition: textPosition,
                        strokeColor: this._featureColor[this._iconList[i]] 
                                     || color[i % color.length]
                    },
                    hoverable: true,
                    clickable: true
                };
                
                if (this._featureIcon[this._iconList[i]]) {
                    itemShape.style.image = this._featureIcon[this._iconList[i]].replace(
                        new RegExp('^image:\\/\\/'), ''
                    );
                    itemShape.style.opacity = 0.8;
                    itemShape.highlightStyle.opacity = 1;
                    itemShape.type = 'image';
                }
                
                if (toolboxOption.orient === 'horizontal') {
                    // 修正左对齐第一个或右对齐最后一个
                    if (i === 0 && textAlign === 'left') {
                        itemShape.highlightStyle.textPosition = 'specific';
                        itemShape.highlightStyle.textAlign = textAlign;
                        itemShape.highlightStyle.textBaseline = textBaseline;
                        itemShape.highlightStyle.textX = lastX;
                        itemShape.highlightStyle.textY = textBaseline === 'top' 
                                                     ? lastY + itemSize + 10
                                                     : lastY - 10;
                    }
                    if (i === iconLength - 1 && textAlign === 'right') {
                        itemShape.highlightStyle.textPosition = 'specific';
                        itemShape.highlightStyle.textAlign = textAlign;
                        itemShape.highlightStyle.textBaseline = textBaseline;
                        itemShape.highlightStyle.textX = lastX + itemSize;
                        itemShape.highlightStyle.textY = textBaseline === 'top' 
                                                         ? lastY + itemSize + 10
                                                         : lastY - 10;
                    }
                }
                
                switch(this._iconList[i]) {
                    case 'mark':
                        itemShape.onclick = self._onMark;
                        break;
                    case 'markUndo':
                        itemShape.onclick = self._onMarkUndo;
                        break;
                    case 'markClear':
                        itemShape.onclick = self._onMarkClear;
                        break;
                    case 'dataZoom':
                        itemShape.onclick = self._onDataZoom;
                        break;
                    case 'dataZoomReset':
                        itemShape.onclick = self._onDataZoomReset;
                        break;
                    case 'dataView' :
                        if (!this._dataView) {
                            var DataView = require('./dataView');
                            this._dataView = new DataView(
                                this.ecTheme, this.messageCenter, this.zr, this.option, this.myChart
                            );
                        }
                        itemShape.onclick = self._onDataView;
                        break;
                    case 'restore':
                        itemShape.onclick = self._onRestore;
                        break;
                    case 'saveAsImage':
                        itemShape.onclick = self._onSaveAsImage;
                        break;
                    default:
                        if (this._iconList[i].match('Chart')) {
                            itemShape._name = this._iconList[i].replace('Chart', '');
                            itemShape.onclick = self._onMagicType;
                        }
                        else {
                            itemShape.onclick = self._onCustomHandler;
                        }
                        break;
                }

                if (itemShape.type === 'icon') {
                    itemShape = new IconShape(itemShape);
                }
                else if (itemShape.type === 'image') {
                    itemShape = new ImageShape(itemShape);
                }
                this.shapeList.push(itemShape);
                this._iconShapeMap[this._iconList[i]] = itemShape;

                if (toolboxOption.orient === 'horizontal') {
                    lastX += itemSize + itemGap;
                }
                else {
                    lastY += itemSize + itemGap;
                }
            }
        },

        _buildBackground: function () {
            var toolboxOption = this.option.toolbox;
            var padding = this.reformCssArray(this.option.toolbox.padding);

            this.shapeList.push(new RectangleShape({
                zlevel: this.getZlevelBase(),
                z: this.getZBase(),
                hoverable :false,
                style: {
                    x: this._itemGroupLocation.x - padding[3],
                    y: this._itemGroupLocation.y - padding[0],
                    width: this._itemGroupLocation.width + padding[3] + padding[1],
                    height: this._itemGroupLocation.height + padding[0] + padding[2],
                    brushType: toolboxOption.borderWidth === 0 ? 'fill' : 'both',
                    color: toolboxOption.backgroundColor,
                    strokeColor: toolboxOption.borderColor,
                    lineWidth: toolboxOption.borderWidth
                }
            }));
        },

        /**
         * 根据选项计算图例实体的位置坐标
         */
        _getItemGroupLocation: function () {
            var toolboxOption = this.option.toolbox;
            var padding = this.reformCssArray(this.option.toolbox.padding);
            var iconLength = this._iconList.length;
            var itemGap = toolboxOption.itemGap;
            var itemSize = toolboxOption.itemSize;
            var totalWidth = 0;
            var totalHeight = 0;

            if (toolboxOption.orient === 'horizontal') {
                // 水平布局，计算总宽度，别忘减去最后一个的itemGap
                totalWidth = (itemSize + itemGap) * iconLength - itemGap;
                totalHeight = itemSize;
            }
            else {
                // 垂直布局，计算总高度
                totalHeight = (itemSize + itemGap) * iconLength - itemGap;
                totalWidth = itemSize;
            }

            var x;
            var zrWidth = this.zr.getWidth();
            switch (toolboxOption.x) {
                case 'center' :
                    x = Math.floor((zrWidth - totalWidth) / 2);
                    break;
                case 'left' :
                    x = padding[3] + toolboxOption.borderWidth;
                    break;
                case 'right' :
                    x = zrWidth
                        - totalWidth
                        - padding[1]
                        - toolboxOption.borderWidth;
                    break;
                default :
                    x = toolboxOption.x - 0;
                    x = isNaN(x) ? 0 : x;
                    break;
            }

            var y;
            var zrHeight = this.zr.getHeight();
            switch (toolboxOption.y) {
                case 'top' :
                    y = padding[0] + toolboxOption.borderWidth;
                    break;
                case 'bottom' :
                    y = zrHeight
                        - totalHeight
                        - padding[2]
                        - toolboxOption.borderWidth;
                    break;
                case 'center' :
                    y = Math.floor((zrHeight - totalHeight) / 2);
                    break;
                default :
                    y = toolboxOption.y - 0;
                    y = isNaN(y) ? 0 : y;
                    break;
            }

            return {
                x: x,
                y: y,
                width: totalWidth,
                height: totalHeight
            };
        },

        __onmousemove: function (param) {
            if (this._marking) {
                this._markShape.style.xEnd = zrEvent.getX(param.event);
                this._markShape.style.yEnd = zrEvent.getY(param.event);
                this.zr.addHoverShape(this._markShape);
            }
            if (this._zooming) {
                this._zoomShape.style.width = 
                    zrEvent.getX(param.event) - this._zoomShape.style.x;
                this._zoomShape.style.height = 
                    zrEvent.getY(param.event) - this._zoomShape.style.y;
                this.zr.addHoverShape(this._zoomShape);
                this.dom.style.cursor = 'crosshair';
                zrEvent.stop(param.event);
            }
            if (this._zoomStart
                && (this.dom.style.cursor != 'pointer' && this.dom.style.cursor != 'move')
            ) {
                this.dom.style.cursor = 'crosshair';
            }
        },

        __onmousedown: function (param) {
            if (param.target) {
                return;
            }
            this._zooming = true;
            var x = zrEvent.getX(param.event);
            var y = zrEvent.getY(param.event);
            var zoomOption = this.option.dataZoom || {};
            this._zoomShape = new RectangleShape({
                zlevel: this.getZlevelBase(),
                z: this.getZBase(),
                style: {
                    x: x,
                    y: y,
                    width: 1,
                    height: 1,
                    brushType: 'both'
                },
                highlightStyle: {
                    lineWidth: 2,
                    color: zoomOption.fillerColor 
                           || ecConfig.dataZoom.fillerColor,
                    strokeColor: zoomOption.handleColor 
                                  || ecConfig.dataZoom.handleColor,
                    brushType: 'both'
                }
            });
            this.zr.addHoverShape(this._zoomShape);
            return true; // 阻塞全局事件
        },
        
        __onmouseup: function (/*param*/) {
            if (!this._zoomShape 
                || Math.abs(this._zoomShape.style.width) < 10 
                || Math.abs(this._zoomShape.style.height) < 10
            ) {
                this._zooming = false;
                return true;
            }
            if (this._zooming && this.component.dataZoom) {
                this._zooming = false;
                
                var zoom = this.component.dataZoom.rectZoom(this._zoomShape.style);
                if (zoom) {
                    this._zoomQueue.push({
                        start: zoom.start,
                        end: zoom.end,
                        start2: zoom.start2,
                        end2: zoom.end2
                    });
                    this._iconEnable(this._iconShapeMap['dataZoomReset']);
                    this.zr.refreshNextFrame();
                }
            }
            return true; // 阻塞全局事件
        },
        
        __onclick: function (param) {
            if (param.target) {
                return;
            }
            if (this._marking) {
                this._marking = false;
                this._markShapeList.push(this._markShape);
                this._iconEnable(this._iconShapeMap['markUndo']);
                this._iconEnable(this._iconShapeMap['markClear']);
                this.zr.addShape(this._markShape);
                this.zr.refreshNextFrame();
            } 
            else if (this._markStart) {
                this._marking = true;
                var x = zrEvent.getX(param.event);
                var y = zrEvent.getY(param.event);
                this._markShape = new LineShape({
                    zlevel: this.getZlevelBase(),
                    z: this.getZBase(),
                    style: {
                        xStart: x,
                        yStart: y,
                        xEnd: x,
                        yEnd: y,
                        lineWidth: this.query(
                                       this.option,
                                       'toolbox.feature.mark.lineStyle.width'
                                   ),
                        strokeColor: this.query(
                                         this.option,
                                         'toolbox.feature.mark.lineStyle.color'
                                     ),
                        lineType: this.query(
                                      this.option,
                                      'toolbox.feature.mark.lineStyle.type'
                                  )
                    }
                });
                this.zr.addHoverShape(this._markShape);
            }
        },
        
        __onMark: function (param) {
            var target = param.target;
            if (this._marking || this._markStart) {
                // 取消
                this._resetMark();
                this.zr.refreshNextFrame();
            }
            else {
                // 启用Mark
                this._resetZoom();   // mark与dataZoom互斥
                
                this.zr.modShape(target.id, {style: {strokeColor: this._enableColor}});
                this.zr.refreshNextFrame();
                this._markStart = true;
                var self = this;
                setTimeout(function (){
                    self.zr
                    && self.zr.on(zrConfig.EVENT.CLICK, self._onclick)
                    && self.zr.on(zrConfig.EVENT.MOUSEMOVE, self._onmousemove);
                }, 10);
            }
            return true; // 阻塞全局事件
        },
        
        __onMarkUndo: function () {
            if (this._marking) {
                this._marking = false;
            } else {
                var len = this._markShapeList.length;
                if (len >= 1) {
                    var target = this._markShapeList[len - 1];
                    this.zr.delShape(target.id);
                    this.zr.refreshNextFrame();
                    this._markShapeList.pop();
                    if (len === 1) {
                        this._iconDisable(this._iconShapeMap['markUndo']);
                        this._iconDisable(this._iconShapeMap['markClear']);
                    }
                }
            }
            return true;
        },

        __onMarkClear: function () {
            if (this._marking) {
                this._marking = false;
            }
            var len = this._markShapeList.length;
            if (len > 0) {
                while(len--) {
                    this.zr.delShape(this._markShapeList.pop().id);
                }
                this._iconDisable(this._iconShapeMap['markUndo']);
                this._iconDisable(this._iconShapeMap['markClear']);
                this.zr.refreshNextFrame();
            }
            return true;
        },
        
        __onDataZoom: function (param) {
            var target = param.target;
            if (this._zooming || this._zoomStart) {
                // 取消
                this._resetZoom();
                this.zr.refreshNextFrame();
                this.dom.style.cursor = 'default';
            }
            else {
                // 启用Zoom
                this._resetMark();   // mark与dataZoom互斥
                
                this.zr.modShape(target.id, {style: {strokeColor: this._enableColor}});
                this.zr.refreshNextFrame();
                this._zoomStart = true;
                var self = this;
                setTimeout(function (){
                    self.zr
                    && self.zr.on(zrConfig.EVENT.MOUSEDOWN, self._onmousedown)
                    && self.zr.on(zrConfig.EVENT.MOUSEUP, self._onmouseup)
                    && self.zr.on(zrConfig.EVENT.MOUSEMOVE, self._onmousemove);
                }, 10);
                
                this.dom.style.cursor = 'crosshair';
            }
            return true; // 阻塞全局事件
        },
        
        __onDataZoomReset: function () {
            if (this._zooming) {
                this._zooming = false;
            }
            this._zoomQueue.pop();
            //console.log(this._zoomQueue)
            if (this._zoomQueue.length > 0) {
                this.component.dataZoom.absoluteZoom(
                    this._zoomQueue[this._zoomQueue.length - 1]
                );
            }
            else {
                this.component.dataZoom.rectZoom();
                this._iconDisable(this._iconShapeMap['dataZoomReset']);
                this.zr.refreshNextFrame();
            }
            
            return true;
        },

        _resetMark: function () {
            this._marking = false;
            if (this._markStart) {
                this._markStart = false;
                if (this._iconShapeMap['mark']) {
                    // 还原图标为未生效状态
                    this.zr.modShape(
                        this._iconShapeMap['mark'].id,
                        {
                            style: {
                                strokeColor: this._iconShapeMap['mark']
                                                 .highlightStyle
                                                 .strokeColor
                            }
                         }
                    );
                }
                
                this.zr.un(zrConfig.EVENT.CLICK, this._onclick);
                this.zr.un(zrConfig.EVENT.MOUSEMOVE, this._onmousemove);
            }
        },
        
        _resetZoom: function () {
            this._zooming = false;
            if (this._zoomStart) {
                this._zoomStart = false;
                if (this._iconShapeMap['dataZoom']) {
                    // 还原图标为未生效状态
                    this.zr.modShape(
                        this._iconShapeMap['dataZoom'].id,
                        {
                            style: {
                                strokeColor: this._iconShapeMap['dataZoom']
                                                 .highlightStyle
                                                 .strokeColor
                            }
                         }
                    );
                }
                
                this.zr.un(zrConfig.EVENT.MOUSEDOWN, this._onmousedown);
                this.zr.un(zrConfig.EVENT.MOUSEUP, this._onmouseup);
                this.zr.un(zrConfig.EVENT.MOUSEMOVE, this._onmousemove);
            }
        },

        _iconDisable: function (target) {
            if (target.type != 'image') {
                this.zr.modShape(target.id, {
                    hoverable: false,
                    clickable: false,
                    style: {
                        strokeColor: this._disableColor
                    }
                });
            }
            else {
                this.zr.modShape(target.id, {
                    hoverable: false,
                    clickable: false,
                    style: {
                        opacity: 0.3
                    }
                });
            }
        },

        _iconEnable: function (target) {
            if (target.type != 'image') {
                this.zr.modShape(target.id, {
                    hoverable: true,
                    clickable: true,
                    style: {
                        strokeColor: target.highlightStyle.strokeColor
                    }
                });
            }
            else {
                this.zr.modShape(target.id, {
                    hoverable: true,
                    clickable: true,
                    style: {
                        opacity: 0.8
                    }
                });
            }
        },

        __onDataView: function () {
            this._dataView.show(this.option);
            return true;
        },

        __onRestore: function (){
            this._resetMark();
            this._resetZoom();
            this.messageCenter.dispatch(ecConfig.EVENT.RESTORE, null, null, this.myChart);
            return true;
        },
        
        __onSaveAsImage: function () {
            var saveOption = this.option.toolbox.feature.saveAsImage;
            var imgType = saveOption.type || 'png';
            if (imgType != 'png' && imgType != 'jpeg') {
                imgType = 'png';
            }
            
            var image;
            if (!this.myChart.isConnected()) {
                image = this.zr.toDataURL(
                    'image/' + imgType,
                    this.option.backgroundColor 
                    && this.option.backgroundColor.replace(' ','') === 'rgba(0,0,0,0)'
                        ? '#fff' : this.option.backgroundColor
                );
            }
            else {
                image = this.myChart.getConnectedDataURL(imgType);
            }
             
            var downloadDiv = document.createElement('div');
            downloadDiv.id = '__echarts_download_wrap__';
            downloadDiv.style.cssText = 'position:fixed;'
                + 'z-index:99999;'
                + 'display:block;'
                + 'top:0;left:0;'
                + 'background-color:rgba(33,33,33,0.5);'
                + 'text-align:center;'
                + 'width:100%;'
                + 'height:100%;'
                + 'line-height:' 
                + document.documentElement.clientHeight + 'px;';
                
            var downloadLink = document.createElement('a');
            //downloadLink.onclick = _saveImageForIE;
            downloadLink.href = image;
            downloadLink.setAttribute(
                'download',
                (saveOption.name 
                 ? saveOption.name 
                 : (this.option.title && (this.option.title.text || this.option.title.subtext))
                   ? (this.option.title.text || this.option.title.subtext)
                   : 'ECharts')
                + '.' + imgType 
            );
            downloadLink.innerHTML = '<img style="vertical-align:middle" src="' + image 
                + '" title="'
                + ((!!window.ActiveXObject || 'ActiveXObject' in window)
                  ? '右键->图片另存为'
                  : (saveOption.lang ? saveOption.lang[0] : '点击保存'))
                + '"/>';
            
            downloadDiv.appendChild(downloadLink);
            document.body.appendChild(downloadDiv);
            downloadLink = null;
            downloadDiv = null;
            
            setTimeout(function (){
                var _d = document.getElementById('__echarts_download_wrap__');
                if (_d) {
                    _d.onclick = function () {
                        var d = document.getElementById(
                            '__echarts_download_wrap__'
                        );
                        d.onclick = null;
                        d.innerHTML = '';
                        document.body.removeChild(d);
                        d = null;
                    };
                    _d = null;
                }
            }, 500);
            
            /*
            function _saveImageForIE() {
                window.win = window.open(image);
                win.document.execCommand("SaveAs");
                win.close()
            }
            */
            return;
        },

        __onMagicType: function (param) {
            this._resetMark();
            var itemName = param.target._name;
            if (!this._magicType[itemName]) {
                // 启用
                this._magicType[itemName] = true;
                // 折柱互斥
                if (itemName === ecConfig.CHART_TYPE_LINE) {
                    this._magicType[ecConfig.CHART_TYPE_BAR] = false;
                }
                else if (itemName === ecConfig.CHART_TYPE_BAR) {
                    this._magicType[ecConfig.CHART_TYPE_LINE] = false;
                }
                // 饼图漏斗互斥
                if (itemName === ecConfig.CHART_TYPE_PIE) {
                    this._magicType[ecConfig.CHART_TYPE_FUNNEL] = false;
                }
                else if (itemName === ecConfig.CHART_TYPE_FUNNEL) {
                    this._magicType[ecConfig.CHART_TYPE_PIE] = false;
                }
                // 力导和弦互斥
                if (itemName === ecConfig.CHART_TYPE_FORCE) {
                    this._magicType[ecConfig.CHART_TYPE_CHORD] = false;
                }
                else if (itemName === ecConfig.CHART_TYPE_CHORD) {
                    this._magicType[ecConfig.CHART_TYPE_FORCE] = false;
                }
                // 堆积平铺互斥
                if (itemName === _MAGICTYPE_STACK) {
                    this._magicType[_MAGICTYPE_TILED] = false;
                }
                else if (itemName === _MAGICTYPE_TILED) {
                    this._magicType[_MAGICTYPE_STACK] = false;
                }
                this.messageCenter.dispatch(
                    ecConfig.EVENT.MAGIC_TYPE_CHANGED,
                    param.event,
                    { magicType: this._magicType },
                    this.myChart
                );
            }
            
            return true;
        },
        
        setMagicType: function (magicType) {
            this._resetMark();
            this._magicType = magicType;
            
            !this._isSilence && this.messageCenter.dispatch(
                ecConfig.EVENT.MAGIC_TYPE_CHANGED,
                null,
                { magicType: this._magicType },
                this.myChart
            );
        },
        
        // 用户自定义扩展toolbox方法
        __onCustomHandler: function (param) {
            var target = param.target.style.iconType;
            var featureHandler = this.option.toolbox.feature[target].onclick;
            if (typeof featureHandler === 'function') {
                featureHandler.call(this, this.option);
            }
        },

        // 重置备份还原状态等
        reset: function (newOption, isRestore) {
            isRestore && this.clear();
            
            if (this.query(newOption, 'toolbox.show')
                && this.query(newOption, 'toolbox.feature.magicType.show')
            ) {
                var magicType = newOption.toolbox.feature.magicType.type;
                var len = magicType.length;
                this._magicMap = {};     // 标识可控类型
                while (len--) {
                    this._magicMap[magicType[len]] = true;
                }

                len = newOption.series.length;
                var oriType;        // 备份还原可控类型
                var axis;
                while (len--) {
                    oriType = newOption.series[len].type;
                    if (this._magicMap[oriType]) {
                        axis = newOption.xAxis instanceof Array
                               ? newOption.xAxis[newOption.series[len].xAxisIndex || 0]
                               : newOption.xAxis;
                        if (axis && (axis.type || 'category') === 'category') {
                            axis.__boundaryGap = axis.boundaryGap != null
                                                 ? axis.boundaryGap : true;
                        }
                        axis = newOption.yAxis instanceof Array
                               ? newOption.yAxis[newOption.series[len].yAxisIndex || 0]
                               : newOption.yAxis;
                        if (axis && axis.type === 'category') {
                            axis.__boundaryGap = axis.boundaryGap != null
                                                 ? axis.boundaryGap : true;
                        }
                        newOption.series[len].__type = oriType;
                        // 避免不同类型图表类型的样式污染
                        newOption.series[len].__itemStyle = zrUtil.clone(
                            newOption.series[len].itemStyle || {}
                        );
                    }
                    
                    if (this._magicMap[_MAGICTYPE_STACK] || this._magicMap[_MAGICTYPE_TILED]) {
                        newOption.series[len].__stack = newOption.series[len].stack;
                    }
                }
            }
            
            this._magicType = isRestore ? {} : (this._magicType || {});
            for (var itemName in this._magicType) {
                if (this._magicType[itemName]) {
                    this.option = newOption;
                    this.getMagicOption();
                    break;
                }
            }
            
            // 框选缩放
            var zoomOption = newOption.dataZoom;
            if (zoomOption && zoomOption.show) {
                var start = zoomOption.start != null
                            && zoomOption.start >= 0
                            && zoomOption.start <= 100
                            ? zoomOption.start : 0;
                var end = zoomOption.end != null
                          && zoomOption.end >= 0
                          && zoomOption.end <= 100
                          ? zoomOption.end : 100;
                if (start > end) {
                    // 大小颠倒自动翻转
                    start = start + end;
                    end = start - end;
                    start = start - end;
                }
                this._zoomQueue = [{
                    start: start,
                    end: end,
                    start2: 0,
                    end2: 100
                }];
            }
            else {
                this._zoomQueue = [];
            }
        },
        
        getMagicOption: function (){
            var axis;
            var chartType;
            if (this._magicType[ecConfig.CHART_TYPE_LINE] 
                || this._magicType[ecConfig.CHART_TYPE_BAR]
            ) {
                // 图表类型有折柱切换
                var boundaryGap = this._magicType[ecConfig.CHART_TYPE_LINE] ? false : true;
                for (var i = 0, l = this.option.series.length; i < l; i++) {
                    chartType = this.option.series[i].type;
                    if (chartType == ecConfig.CHART_TYPE_LINE
                        || chartType == ecConfig.CHART_TYPE_BAR
                    ) {
                        axis = this.option.xAxis instanceof Array
                               ? this.option.xAxis[this.option.series[i].xAxisIndex || 0]
                               : this.option.xAxis;
                        if (axis && (axis.type || 'category') === 'category') {
                            axis.boundaryGap = boundaryGap ? true : axis.__boundaryGap;
                        }
                        axis = this.option.yAxis instanceof Array
                               ? this.option.yAxis[this.option.series[i].yAxisIndex || 0]
                               : this.option.yAxis;
                        if (axis && axis.type === 'category') {
                            axis.boundaryGap = boundaryGap ? true : axis.__boundaryGap;
                        }
                    }
                }
                
                this._defaultMagic(ecConfig.CHART_TYPE_LINE, ecConfig.CHART_TYPE_BAR);
            }
            this._defaultMagic(ecConfig.CHART_TYPE_CHORD, ecConfig.CHART_TYPE_FORCE);
            this._defaultMagic(ecConfig.CHART_TYPE_PIE, ecConfig.CHART_TYPE_FUNNEL);
            
            if (this._magicType[_MAGICTYPE_STACK] || this._magicType[_MAGICTYPE_TILED]) {
                // 有堆积平铺切换
                for (var i = 0, l = this.option.series.length; i < l; i++) {
                    if (this._magicType[_MAGICTYPE_STACK]) {
                        // 启用堆积
                        this.option.series[i].stack = '_ECHARTS_STACK_KENER_2014_';
                        chartType = _MAGICTYPE_STACK;
                    }
                    else if (this._magicType[_MAGICTYPE_TILED]) {
                        // 启用平铺
                        this.option.series[i].stack = null;
                        chartType = _MAGICTYPE_TILED;
                    }
                    if (this._featureOption[chartType + 'Chart']) {
                        zrUtil.merge(
                            this.option.series[i],
                            this._featureOption[chartType + 'Chart'] || {},
                            true
                        );
                    }
                }
            }
            return this.option;
        },
        
        _defaultMagic : function(cType1, cType2) {
            if (this._magicType[cType1] || this._magicType[cType2]) {
                for (var i = 0, l = this.option.series.length; i < l; i++) {
                    var chartType = this.option.series[i].type;
                    if (chartType == cType1 || chartType == cType2) {
                        this.option.series[i].type = this._magicType[cType1] ? cType1 : cType2;
                        // 避免不同类型图表类型的样式污染
                        this.option.series[i].itemStyle = zrUtil.clone(
                            this.option.series[i].__itemStyle
                        );
                        chartType = this.option.series[i].type;
                        if (this._featureOption[chartType + 'Chart']) {
                            zrUtil.merge(
                                this.option.series[i],
                                this._featureOption[chartType + 'Chart'] || {},
                                true
                            );
                        }
                    }
                }
            }
        },

        silence: function (s) {
            this._isSilence = s;
        },
        
        resize: function () {
            this._resetMark();
            this.clear();
            if (this.option && this.option.toolbox && this.option.toolbox.show) {
               this._buildShape();
            }
            if (this._dataView) {
                this._dataView.resize();
            }
        },

        hideDataView: function () {
            if (this._dataView) {
                this._dataView.hide();
            }
        },
        
        clear: function(notMark) {
            if (this.zr) {
                this.zr.delShape(this.shapeList);
                this.shapeList = [];
                
                if (!notMark) {
                    this.zr.delShape(this._markShapeList);
                    this._markShapeList = [];
                }
            }
        },
        
        /**
         * 释放后实例不可用
         */
        onbeforDispose: function () {
            if (this._dataView) {
                this._dataView.dispose();
                this._dataView = null;
            }
            this._markShapeList = null;
        },
        
        /**
         * 刷新
         */
        refresh: function (newOption) {
            if (newOption) {
                this._resetMark();
                this._resetZoom();
                
                newOption.toolbox = this.reformOption(newOption.toolbox);
                this.option = newOption;
                
                this.clear(true);
    
                if (newOption.toolbox.show) {
                    this._buildShape();
                }
    
                this.hideDataView();
            }
        }
    };
    
    zrUtil.inherits(Toolbox, Base);
    
    require('../component').define('toolbox', Toolbox);
    
    return Toolbox;
});
define('echarts/chart/island', ['require', './base', 'zrender/shape/Circle', '../config', '../util/ecData', 'zrender/tool/util', 'zrender/tool/event', 'zrender/tool/color', '../util/accMath', '../chart'], function (require) {
    var ChartBase = require('./base');
    
    // 图形依赖
    var CircleShape = require('zrender/shape/Circle');
    
    var ecConfig = require('../config');
    ecConfig.island = {
        zlevel: 0,                  // 一级层叠
        z: 5,                       // 二级层叠
        r: 15,
        calculateStep: 0.1  // 滚轮可计算步长 0.1 = 10%
    };

    var ecData = require('../util/ecData');
    var zrUtil = require('zrender/tool/util');
    var zrEvent = require('zrender/tool/event');
    
    /**
     * 构造函数
     * @param {Object} messageCenter echart消息中心
     * @param {ZRender} zr zrender实例
     * @param {Object} option 图表选项
     */
    function Island(ecTheme, messageCenter, zr, option, myChart) {
        // 图表基类
        ChartBase.call(this, ecTheme, messageCenter, zr, option, myChart);

        this._nameConnector;
        this._valueConnector;
        this._zrHeight = this.zr.getHeight();
        this._zrWidth = this.zr.getWidth();

        var self = this;
        /**
         * 滚轮改变孤岛数据值
         */
        self.shapeHandler.onmousewheel = function (param) {
            var shape = param.target;

            var event = param.event;
            var delta = zrEvent.getDelta(event);
            delta = delta > 0 ? (-1) : 1;
            shape.style.r -= delta;
            shape.style.r = shape.style.r < 5 ? 5 : shape.style.r;

            var value = ecData.get(shape, 'value');
            var dvalue = value * self.option.island.calculateStep;
            value = dvalue > 1
                    ? (Math.round(value - dvalue * delta))
                    : +(value - dvalue * delta).toFixed(2);

            var name = ecData.get(shape, 'name');
            shape.style.text = name + ':' + value;

            ecData.set(shape, 'value', value);
            ecData.set(shape, 'name', name);

            self.zr.modShape(shape.id);
            self.zr.refreshNextFrame();
            zrEvent.stop(event);
        };
    }
    
    Island.prototype = {
        type: ecConfig.CHART_TYPE_ISLAND,
        /**
         * 孤岛合并
         *
         * @param {string} tarShapeIndex 目标索引
         * @param {Object} srcShape 源目标，合入目标后删除
         */
        _combine: function (tarShape, srcShape) {
            var zrColor = require('zrender/tool/color');
            var accMath = require('../util/accMath');
            var value = accMath.accAdd(
                            ecData.get(tarShape, 'value'),
                            ecData.get(srcShape, 'value')
                        );
            var name = ecData.get(tarShape, 'name')
                       + this._nameConnector
                       + ecData.get(srcShape, 'name');

            tarShape.style.text = name + this._valueConnector + value;

            ecData.set(tarShape, 'value', value);
            ecData.set(tarShape, 'name', name);
            tarShape.style.r = this.option.island.r;
            tarShape.style.color = zrColor.mix(
                tarShape.style.color,
                srcShape.style.color
            );
        },

        /**
         * 刷新
         */
        refresh: function (newOption) {
            if (newOption) {
                newOption.island = this.reformOption(newOption.island);
                this.option = newOption;
    
                this._nameConnector = this.option.nameConnector;
                this._valueConnector = this.option.valueConnector;
            }
        },
        
        getOption: function () {
            return this.option;
        },

        resize: function () {
            var newWidth = this.zr.getWidth();
            var newHieght = this.zr.getHeight();
            var xScale = newWidth / (this._zrWidth || newWidth);
            var yScale = newHieght / (this._zrHeight || newHieght);
            if (xScale === 1 && yScale === 1) {
                return;
            }
            this._zrWidth = newWidth;
            this._zrHeight = newHieght;
            for (var i = 0, l = this.shapeList.length; i < l; i++) {
                this.zr.modShape(
                    this.shapeList[i].id,
                    {
                        style: {
                            x: Math.round(this.shapeList[i].style.x * xScale),
                            y: Math.round(this.shapeList[i].style.y * yScale)
                        }
                    }
                );
            }
        },

        add: function (shape) {
            var name = ecData.get(shape, 'name');
            var value = ecData.get(shape, 'value');
            var seriesName = ecData.get(shape, 'series') != null
                             ? ecData.get(shape, 'series').name
                             : '';
            var font = this.getFont(this.option.island.textStyle);
            var islandOption = this.option.island;
            var islandShape = {
                zlevel: islandOption.zlevel,
                z: islandOption.z,
                style: {
                    x: shape.style.x,
                    y: shape.style.y,
                    r: this.option.island.r,
                    color: shape.style.color || shape.style.strokeColor,
                    text: name + this._valueConnector + value,
                    textFont: font
                },
                draggable: true,
                hoverable: true,
                onmousewheel: this.shapeHandler.onmousewheel,
                _type: 'island'
            };
            if (islandShape.style.color === '#fff') {
                islandShape.style.color = shape.style.strokeColor;
            }
            this.setCalculable(islandShape);
            islandShape.dragEnableTime = 0;
            ecData.pack(
                islandShape,
                {name:seriesName}, -1,
                value, -1,
                name
            );
            islandShape = new CircleShape(islandShape);
            this.shapeList.push(islandShape);
            this.zr.addShape(islandShape);
        },

        del: function (shape) {
            this.zr.delShape(shape.id);
            var newShapeList = [];
            for (var i = 0, l = this.shapeList.length; i < l; i++) {
                if (this.shapeList[i].id != shape.id) {
                    newShapeList.push(this.shapeList[i]);
                }
            }
            this.shapeList = newShapeList;
        },

        /**
         * 数据项被拖拽进来， 重载基类方法
         */
        ondrop: function (param, status) {
            if (!this.isDrop || !param.target) {
                // 没有在当前实例上发生拖拽行为则直接返回
                return;
            }
            // 拖拽产生孤岛数据合并
            var target = param.target;      // 拖拽安放目标
            var dragged = param.dragged;    // 当前被拖拽的图形对象

            this._combine(target, dragged);
            this.zr.modShape(target.id);

            status.dragIn = true;

            // 处理完拖拽事件后复位
            this.isDrop = false;

            return;
        },

        /**
         * 数据项被拖拽出去， 重载基类方法
         */
        ondragend: function (param, status) {
            var target = param.target;      // 拖拽安放目标
            if (!this.isDragend) {
                // 拖拽的不是孤岛数据，如果没有图表接受孤岛数据，需要新增孤岛数据
                if (!status.dragIn) {
                    target.style.x = zrEvent.getX(param.event);
                    target.style.y = zrEvent.getY(param.event);
                    this.add(target);
                    status.needRefresh = true;
                }
            }
            else {
                // 拖拽的是孤岛数据，如果有图表接受了孤岛数据，需要删除孤岛数据
                if (status.dragIn) {
                    this.del(target);
                    status.needRefresh = true;
                }
            }

            // 处理完拖拽事件后复位
            this.isDragend = false;

            return;
        }
    };
    
    zrUtil.inherits(Island, ChartBase);
    
    // 图表注册
    require('../chart').define('island', Island);
    
    return Island;
});
define('echarts/component/legend', ['require', './base', 'zrender/shape/Text', 'zrender/shape/Rectangle', 'zrender/shape/Sector', '../util/shape/Icon', '../util/shape/Candle', '../config', 'zrender/tool/util', 'zrender/tool/area', '../component'], function (require) {
    var Base = require('./base');
    
    // 图形依赖
    var TextShape = require('zrender/shape/Text');
    var RectangleShape = require('zrender/shape/Rectangle');
    var SectorShape = require('zrender/shape/Sector');
    //var BeziercurveShape = require('zrender/shape/Beziercurve');
    var IconShape = require('../util/shape/Icon');
    var CandleShape = require('../util/shape/Candle');
    
    var ecConfig = require('../config');
     // 图例
    ecConfig.legend = {
        zlevel: 0,                  // 一级层叠
        z: 4,                       // 二级层叠
        show: true,
        orient: 'horizontal',      // 布局方式，默认为水平布局，可选为：
                                   // 'horizontal' ¦ 'vertical'
        x: 'center',               // 水平安放位置，默认为全图居中，可选为：
                                   // 'center' ¦ 'left' ¦ 'right'
                                   // ¦ {number}（x坐标，单位px）
        y: 'top',                  // 垂直安放位置，默认为全图顶端，可选为：
                                   // 'top' ¦ 'bottom' ¦ 'center'
                                   // ¦ {number}（y坐标，单位px）
        backgroundColor: 'rgba(0,0,0,0)',
        borderColor: '#ccc',       // 图例边框颜色
        borderWidth: 0,            // 图例边框线宽，单位px，默认为0（无边框）
        padding: 5,                // 图例内边距，单位px，默认各方向内边距为5，
                                   // 接受数组分别设定上右下左边距，同css
        itemGap: 10,               // 各个item之间的间隔，单位px，默认为10，
                                   // 横向布局时为水平间隔，纵向布局时为纵向间隔
        itemWidth: 20,             // 图例图形宽度
        itemHeight: 14,            // 图例图形高度
        textStyle: {
            color: '#333'          // 图例文字颜色
        },
        selectedMode: true         // 选择模式，默认开启图例开关
        // selected: null,         // 配置默认选中状态，可配合LEGEND.SELECTED事件做动态数据载入
        // data: [],               // 图例内容（详见legend.data，数组中每一项代表一个item
    };

    var zrUtil = require('zrender/tool/util');
    var zrArea = require('zrender/tool/area');

    /**
     * 构造函数
     * @param {Object} messageCenter echart消息中心
     * @param {ZRender} zr zrender实例
     * @param {Object} option 图表参数
     */
    function Legend(ecTheme, messageCenter, zr, option, myChart) {
        if (!this.query(option, 'legend.data')) {
            console.error('option.legend.data has not been defined.');
            return;
        }
        
        Base.call(this, ecTheme, messageCenter, zr, option, myChart);
        
        var self = this;
        self._legendSelected = function (param) {
            self.__legendSelected(param);
        };
        self._dispatchHoverLink = function(param) {
            return self.__dispatchHoverLink(param);
        };
        
        this._colorIndex = 0;
        this._colorMap = {};
        this._selectedMap = {};
        this._hasDataMap = {};
        
        this.refresh(option);
    }
    
    Legend.prototype = {
        type: ecConfig.COMPONENT_TYPE_LEGEND,
        _buildShape: function () {
            if (!this.legendOption.show) {
                return;
            }
            // 图例元素组的位置参数，通过计算所得x, y, width, height
            this._itemGroupLocation = this._getItemGroupLocation();

            this._buildBackground();
            this._buildItem();

            for (var i = 0, l = this.shapeList.length; i < l; i++) {
                this.zr.addShape(this.shapeList[i]);
            }
        },

        /**
         * 构建所有图例元素
         */
        _buildItem: function () {
            var data = this.legendOption.data;
            var dataLength = data.length;
            var itemName;
            var itemType;
            var itemShape;
            var textShape;
            var textStyle  = this.legendOption.textStyle;
            var dataTextStyle;
            var dataFont;
            var formattedName;

            var zrWidth = this.zr.getWidth();
            var zrHeight = this.zr.getHeight();
            var lastX = this._itemGroupLocation.x;
            var lastY = this._itemGroupLocation.y;
            var itemWidth = this.legendOption.itemWidth;
            var itemHeight = this.legendOption.itemHeight;
            var itemGap = this.legendOption.itemGap;
            var color;

            if (this.legendOption.orient === 'vertical' && this.legendOption.x === 'right') {
                lastX = this._itemGroupLocation.x
                        + this._itemGroupLocation.width
                        - itemWidth;
            }

            for (var i = 0; i < dataLength; i++) {
                dataTextStyle = zrUtil.merge(
                    data[i].textStyle || {},
                    textStyle
                );
                dataFont = this.getFont(dataTextStyle);
                
                itemName = this._getName(data[i]);
                formattedName = this._getFormatterName(itemName);
                if (itemName === '') { // 别帮我代码优化
                    if (this.legendOption.orient === 'horizontal') {
                        lastX = this._itemGroupLocation.x;
                        lastY += itemHeight + itemGap;
                    }
                    else {
                        this.legendOption.x === 'right'
                            ? lastX -= this._itemGroupLocation.maxWidth + itemGap
                            : lastX += this._itemGroupLocation.maxWidth + itemGap;
                        lastY = this._itemGroupLocation.y;
                    }
                    continue;
                }
                itemType = data[i].icon || this._getSomethingByName(itemName).type;
                
                color = this.getColor(itemName);

                if (this.legendOption.orient === 'horizontal') {
                    if (zrWidth - lastX < 200   // 最后200px做分行预判
                        && (itemWidth + 5 + zrArea.getTextWidth(formattedName, dataFont)
                            // 分行的最后一个不用算itemGap
                            + (i === dataLength - 1 || data[i + 1] === '' ? 0 : itemGap)
                           ) >= zrWidth - lastX
                    ) {
                        lastX = this._itemGroupLocation.x;
                        lastY += itemHeight + itemGap;
                    }
                }
                else {
                    if (zrHeight - lastY < 200   // 最后200px做分行预判
                        && (itemHeight
                            // 分行的最后一个不用算itemGap
                            + (i === dataLength - 1 || data[i + 1] === '' ? 0 : itemGap)
                           ) 
                           >= zrHeight - lastY
                    ) {
                        this.legendOption.x === 'right'
                        ? lastX -= this._itemGroupLocation.maxWidth + itemGap
                        : lastX += this._itemGroupLocation.maxWidth + itemGap;
                        lastY = this._itemGroupLocation.y;
                    }
                }

                // 图形
                itemShape = this._getItemShapeByType(
                    lastX, lastY,
                    itemWidth, itemHeight,
                    (this._selectedMap[itemName] && this._hasDataMap[itemName] ? color : '#ccc'),
                    itemType,
                    color
                );
                itemShape._name = itemName;
                itemShape = new IconShape(itemShape);

                // 文字
                textShape = {
                    // shape: 'text',
                    zlevel: this.getZlevelBase(),
                    z: this.getZBase(),
                    style: {
                        x: lastX + itemWidth + 5,
                        y: lastY + itemHeight / 2,
                        color: this._selectedMap[itemName]
                                ? (dataTextStyle.color === 'auto' ? color : dataTextStyle.color)
                                : '#ccc',
                        text: formattedName,
                        textFont: dataFont,
                        textBaseline: 'middle'
                    },
                    highlightStyle: {
                        color: color,
                        brushType: 'fill'
                    },
                    hoverable: !!this.legendOption.selectedMode,
                    clickable: !!this.legendOption.selectedMode
                };

                if (this.legendOption.orient === 'vertical'
                    && this.legendOption.x === 'right'
                ) {
                    textShape.style.x -= (itemWidth + 10);
                    textShape.style.textAlign = 'right';
                }

                textShape._name = itemName;
                textShape = new TextShape(textShape);
                
                if (this.legendOption.selectedMode) {
                    itemShape.onclick = textShape.onclick = this._legendSelected;
                    itemShape.onmouseover =  textShape.onmouseover = this._dispatchHoverLink;
                    itemShape.hoverConnect = textShape.id;
                    textShape.hoverConnect = itemShape.id;
                }
                this.shapeList.push(itemShape);
                this.shapeList.push(textShape);

                if (this.legendOption.orient === 'horizontal') {
                    lastX += itemWidth + 5
                             + zrArea.getTextWidth(formattedName, dataFont)
                             + itemGap;
                }
                else {
                    lastY += itemHeight + itemGap;
                }
            }
        
            if (this.legendOption.orient === 'horizontal'
                && this.legendOption.x === 'center'
                && lastY != this._itemGroupLocation.y
            ) {
                // 多行橫排居中优化
                this._mLineOptimize();
            }
        },
        
        _getName: function(data) {
            return typeof data.name != 'undefined' ? data.name : data;
        },

        _getFormatterName: function(itemName) {
            var formatter = this.legendOption.formatter;
            var formattedName;
            if (typeof formatter === 'function') {
                formattedName = formatter.call(this.myChart, itemName);
            }
            else if (typeof formatter === 'string') {
                formattedName = formatter.replace('{name}', itemName);
            }
            else {
                formattedName = itemName;
            }
            return formattedName;
        },

        _getFormatterNameFromData: function(data) {
            var itemName = this._getName(data);
            return this._getFormatterName(itemName);
        },
        
        // 多行橫排居中优化
        _mLineOptimize: function () {
            var lineOffsetArray = []; // 每行宽度
            var lastX = this._itemGroupLocation.x;
            for (var i = 2, l = this.shapeList.length; i < l; i++) {
                if (this.shapeList[i].style.x === lastX) {
                    lineOffsetArray.push(
                        (
                            this._itemGroupLocation.width 
                            - (
                                this.shapeList[i - 1].style.x
                                + zrArea.getTextWidth(
                                      this.shapeList[i - 1].style.text,
                                      this.shapeList[i - 1].style.textFont
                                  )
                                - lastX
                            )
                        ) / 2
                    );
                }
                else if (i === l - 1) {
                    lineOffsetArray.push(
                        (
                            this._itemGroupLocation.width 
                            - (
                                this.shapeList[i].style.x
                                + zrArea.getTextWidth(
                                      this.shapeList[i].style.text,
                                      this.shapeList[i].style.textFont
                                  )
                                - lastX
                            )
                        ) / 2
                    );
                }
            }
            var curLineIndex = -1;
            for (var i = 1, l = this.shapeList.length; i < l; i++) {
                if (this.shapeList[i].style.x === lastX) {
                    curLineIndex++;
                }
                if (lineOffsetArray[curLineIndex] === 0) {
                    continue;
                }
                else {
                    this.shapeList[i].style.x += lineOffsetArray[curLineIndex];
                }
            }
        },

        _buildBackground: function () {
            var padding = this.reformCssArray(this.legendOption.padding);

            this.shapeList.push(new RectangleShape({
                zlevel: this.getZlevelBase(),
                z: this.getZBase(),
                hoverable :false,
                style: {
                    x: this._itemGroupLocation.x - padding[3],
                    y: this._itemGroupLocation.y - padding[0],
                    width: this._itemGroupLocation.width + padding[3] + padding[1],
                    height: this._itemGroupLocation.height + padding[0] + padding[2],
                    brushType: this.legendOption.borderWidth === 0 ? 'fill' : 'both',
                    color: this.legendOption.backgroundColor,
                    strokeColor: this.legendOption.borderColor,
                    lineWidth: this.legendOption.borderWidth
                }
            }));
        },

        /**
         * 根据选项计算图例实体的位置坐标
         */
        _getItemGroupLocation: function () {
            var data = this.legendOption.data;
            var dataLength = data.length;
            var itemGap = this.legendOption.itemGap;
            var itemWidth = this.legendOption.itemWidth + 5; // 5px是图形和文字的间隔，不可配
            var itemHeight = this.legendOption.itemHeight;
            var textStyle  = this.legendOption.textStyle;
            var font = this.getFont(textStyle);
            var totalWidth = 0;
            var totalHeight = 0;
            var padding = this.reformCssArray(this.legendOption.padding);
            var zrWidth = this.zr.getWidth() - padding[1] - padding[3];
            var zrHeight = this.zr.getHeight() - padding[0] - padding[2];
            
            var temp = 0; // 宽高计算，用于多行判断
            var maxWidth = 0; // 垂直布局有用
            if (this.legendOption.orient === 'horizontal') {
                // 水平布局，计算总宽度
                totalHeight = itemHeight;
                for (var i = 0; i < dataLength; i++) {
                    if (this._getName(data[i]) === '') {
                        temp -= itemGap;
                        totalWidth = Math.max(totalWidth, temp);
                        totalHeight += itemHeight + itemGap;
                        temp = 0;
                        continue;
                    }
                    var tempTextWidth = zrArea.getTextWidth(
                        this._getFormatterNameFromData(data[i]),
                        data[i].textStyle 
                        ? this.getFont(zrUtil.merge(
                            data[i].textStyle || {},
                            textStyle
                          ))
                        : font
                    );
                    if (temp + itemWidth + tempTextWidth + itemGap > zrWidth) {
                        // new line
                        temp -= itemGap;  // 减去最后一个的itemGap
                        totalWidth = Math.max(totalWidth, temp);
                        totalHeight += itemHeight + itemGap;
                        temp = 0;
                    }
                    else {
                        temp += itemWidth + tempTextWidth + itemGap;
                        totalWidth = Math.max(totalWidth, temp - itemGap);
                    }
                }
            }
            else {
                // 垂直布局，计算总高度
                for (var i = 0; i < dataLength; i++) {
                    maxWidth = Math.max(
                        maxWidth,
                        zrArea.getTextWidth(
                            this._getFormatterNameFromData(data[i]),
                            data[i].textStyle 
                            ? this.getFont(zrUtil.merge(
                                  data[i].textStyle || {},
                                  textStyle
                              ))
                            : font
                        )
                    );
                }
                maxWidth += itemWidth;
                totalWidth = maxWidth;
                for (var i = 0; i < dataLength; i++) {
                    if (this._getName(data[i]) === '') {
                        totalWidth += maxWidth + itemGap;
                        temp -= itemGap;  // 减去最后一个的itemGap
                        totalHeight = Math.max(totalHeight, temp);
                        temp = 0;
                        continue;
                    }
                    if (temp + itemHeight + itemGap > zrHeight) {
                        // new line
                        totalWidth += maxWidth + itemGap;
                        temp -= itemGap;  // 减去最后一个的itemGap
                        totalHeight = Math.max(totalHeight, temp);
                        temp = 0;
                    }
                    else {
                        temp += itemHeight + itemGap;
                        totalHeight = Math.max(totalHeight, temp - itemGap);
                    }
                }
            }

            zrWidth = this.zr.getWidth();
            zrHeight = this.zr.getHeight();
            var x;
            switch (this.legendOption.x) {
                case 'center' :
                    x = Math.floor((zrWidth - totalWidth) / 2);
                    break;
                case 'left' :
                    x = padding[3] + this.legendOption.borderWidth;
                    break;
                case 'right' :
                    x = zrWidth
                        - totalWidth
                        - padding[1]
                        - padding[3]
                        - this.legendOption.borderWidth * 2;
                    break;
                default :
                    x = this.parsePercent(this.legendOption.x, zrWidth);
                    break;
            }
            
            var y;
            switch (this.legendOption.y) {
                case 'top' :
                    y = padding[0] + this.legendOption.borderWidth;
                    break;
                case 'bottom' :
                    y = zrHeight
                        - totalHeight
                        - padding[0]
                        - padding[2]
                        - this.legendOption.borderWidth * 2;
                    break;
                case 'center' :
                    y = Math.floor((zrHeight - totalHeight) / 2);
                    break;
                default :
                    y = this.parsePercent(this.legendOption.y, zrHeight);
                    break;
            }

            return {
                x: x,
                y: y,
                width: totalWidth,
                height: totalHeight,
                maxWidth: maxWidth
            };
        },

        /**
         * 根据名称返回series数据或data
         */
        _getSomethingByName: function (name) {
            var series = this.option.series;
            var data;
            for (var i = 0, l = series.length; i < l; i++) {
                if (series[i].name === name) {
                    // 系列名称优先
                    return {
                        type: series[i].type,
                        series: series[i],
                        seriesIndex: i,
                        data: null,
                        dataIndex: -1
                    };
                }

                if (
                    series[i].type === ecConfig.CHART_TYPE_PIE 
                    || series[i].type === ecConfig.CHART_TYPE_RADAR
                    || series[i].type === ecConfig.CHART_TYPE_CHORD
                    || series[i].type === ecConfig.CHART_TYPE_FORCE
                    || series[i].type === ecConfig.CHART_TYPE_FUNNEL
                    || series[i].type === ecConfig.CHART_TYPE_TREEMAP
                ) {
                    data = series[i].categories || series[i].data || series[i].nodes;

                    for (var j = 0, k = data.length; j < k; j++) {
                        if (data[j].name === name) {
                            return {
                                type: series[i].type,
                                series: series[i],
                                seriesIndex: i,
                                data: data[j],
                                dataIndex: j
                            };
                        }
                    }
                }
            }
            return {
                type: 'bar',
                series: null,
                seriesIndex: -1,
                data: null,
                dataIndex: -1
            };
        },
        
        _getItemShapeByType: function (x, y, width, height, color, itemType, defaultColor) {
            var highlightColor = color === '#ccc' ? defaultColor : color;
            var itemShape = {
                zlevel: this.getZlevelBase(),
                z: this.getZBase(),
                style: {
                    iconType: 'legendicon' + itemType,
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                    color: color,
                    strokeColor: color,
                    lineWidth: 2
                },
                highlightStyle: {
                    color: highlightColor,
                    strokeColor: highlightColor,
                    lineWidth: 1
                },
                hoverable: this.legendOption.selectedMode,
                clickable: this.legendOption.selectedMode
            };
            
            var imageLocation;
            if (itemType.match('image')) {
                var imageLocation = itemType.replace(
                    new RegExp('^image:\\/\\/'), ''
                );
                itemType = 'image';
            }
            // 特殊设置
            switch (itemType) {
                case 'line':
                    itemShape.style.brushType = 'stroke';
                    itemShape.highlightStyle.lineWidth = 3;
                    break;
                case 'radar':
                case 'venn':
                case 'tree':
                case 'treemap':
                case 'scatter':
                    itemShape.highlightStyle.lineWidth = 3;
                    break;
                case 'k':
                    itemShape.style.brushType = 'both';
                    itemShape.highlightStyle.lineWidth = 3;
                    itemShape.highlightStyle.color =
                    itemShape.style.color = this.deepQuery(
                        [this.ecTheme, ecConfig], 'k.itemStyle.normal.color'
                    ) || '#fff';
                    itemShape.style.strokeColor = color != '#ccc' 
                        ? (
                            this.deepQuery(
                                [this.ecTheme, ecConfig], 'k.itemStyle.normal.lineStyle.color'
                            ) || '#ff3200'
                        )
                        : color;
                    break;
                case 'image':
                    itemShape.style.iconType = 'image';
                    itemShape.style.image = imageLocation;
                    if (color === '#ccc') {
                        itemShape.style.opacity = 0.5;
                    }
                    break;
            }
            return itemShape;
        },

        __legendSelected: function (param) {
            var itemName = param.target._name;
            if (this.legendOption.selectedMode === 'single') {
                for (var k in this._selectedMap) {
                    this._selectedMap[k] = false;
                }
            }
            this._selectedMap[itemName] = !this._selectedMap[itemName];
            this.messageCenter.dispatch(
                ecConfig.EVENT.LEGEND_SELECTED,
                param.event,
                {
                    selected: this._selectedMap,
                    target: itemName
                },
                this.myChart
            );
        },
        
        /**
         * 产生hover link事件 
         */
        __dispatchHoverLink : function(param) {
            this.messageCenter.dispatch(
                ecConfig.EVENT.LEGEND_HOVERLINK,
                param.event,
                {
                    target: param.target._name
                },
                this.myChart
            );
            return;
        },
        
        /**
         * 刷新
         */
        refresh: function (newOption) {
            if (newOption) {
                this.option = newOption || this.option;
                this.option.legend = this.reformOption(this.option.legend);
                this.legendOption = this.option.legend;
                
                var data = this.legendOption.data || [];
                var itemName;
                var something;
                var color;
                var queryTarget;
                if (this.legendOption.selected) {
                    for (var k in this.legendOption.selected) {
                        this._selectedMap[k] = typeof this._selectedMap[k] != 'undefined'
                                               ? this._selectedMap[k]
                                               : this.legendOption.selected[k];
                    }
                }
                for (var i = 0, dataLength = data.length; i < dataLength; i++) {
                    itemName = this._getName(data[i]);
                    if (itemName === '') {
                        continue;
                    }
                    something = this._getSomethingByName(itemName);
                    if (!something.series) {
                        this._hasDataMap[itemName] = false;
                    } 
                    else {
                        this._hasDataMap[itemName] = true;
                        if (something.data
                            && (something.type === ecConfig.CHART_TYPE_PIE
                                || something.type === ecConfig.CHART_TYPE_FORCE
                                || something.type === ecConfig.CHART_TYPE_FUNNEL)
                        ) {
                            queryTarget = [something.data, something.series];
                        }
                        else {
                            queryTarget = [something.series];
                        }
                        
                        color = this.getItemStyleColor(
                            this.deepQuery(queryTarget, 'itemStyle.normal.color'),
                            something.seriesIndex,
                            something.dataIndex,
                            something.data
                        );
                        if (color && something.type != ecConfig.CHART_TYPE_K) {
                            this.setColor(itemName, color);
                        }
                        this._selectedMap[itemName] = 
                            this._selectedMap[itemName] != null
                            ? this._selectedMap[itemName] : true; 
                    }
                }
            }
            this.clear();
            this._buildShape();
        },
        
        getRelatedAmount: function(name) {
            var amount = 0;
            var series = this.option.series;
            var data;
            for (var i = 0, l = series.length; i < l; i++) {
                if (series[i].name === name) {
                    // 系列名称优先
                    amount++;
                }

                if (
                    series[i].type === ecConfig.CHART_TYPE_PIE 
                    || series[i].type === ecConfig.CHART_TYPE_RADAR
                    || series[i].type === ecConfig.CHART_TYPE_CHORD
                    || series[i].type === ecConfig.CHART_TYPE_FORCE
                    || series[i].type === ecConfig.CHART_TYPE_FUNNEL
                ) {
                    data = series[i].type != ecConfig.CHART_TYPE_FORCE
                           ? series[i].data         // 饼图、雷达图、和弦图得查找里面的数据名字
                           : series[i].categories;  // 力导布局查找categories配置
                    for (var j = 0, k = data.length; j < k; j++) {
                        if (data[j].name === name && data[j].value != '-') {
                            amount++;
                        }
                    }
                }
            }
            return amount;
        },

        setColor: function (legendName, color) {
            this._colorMap[legendName] = color;
        },

        getColor: function (legendName) {
            if (!this._colorMap[legendName]) {
                this._colorMap[legendName] = this.zr.getColor(this._colorIndex++);
            }
            return this._colorMap[legendName];
        },
        
        hasColor: function (legendName) {
            return this._colorMap[legendName] ? this._colorMap[legendName] : false;
        },

        add: function (name, color){
            var data = this.legendOption.data;
            for (var i = 0, dataLength = data.length; i < dataLength; i++) {
                if (this._getName(data[i]) === name) {
                    // 已有就不重复加了
                    return;
                }
            }
            this.legendOption.data.push(name);
            this.setColor(name,color);
            this._selectedMap[name] = true;
            this._hasDataMap[name] = true;
        },

        del: function (name){
            var data = this.legendOption.data;
            for (var i = 0, dataLength = data.length; i < dataLength; i++) {
                if (this._getName(data[i]) === name) {
                    return this.legendOption.data.splice(i, 1);
                }
            }
        },
        
        /**
         * 特殊图形元素回调设置
         * @param {Object} name
         * @param {Object} itemShape
         */
        getItemShape: function (name) {
            if (name == null) {
                return;
            }
            var shape;
            for (var i = 0, l = this.shapeList.length; i < l; i++) {
                shape = this.shapeList[i];
                if (shape._name === name && shape.type != 'text') {
                    return shape;
                }
            }
        },
        
        /**
         * 特殊图形元素回调设置
         * @param {Object} name
         * @param {Object} itemShape
         */
        setItemShape: function (name, itemShape) {
            var shape;
            for (var i = 0, l = this.shapeList.length; i < l; i++) {
                shape = this.shapeList[i];
                if (shape._name === name && shape.type != 'text') {
                    if (!this._selectedMap[name]) {
                        itemShape.style.color = '#ccc';
                        itemShape.style.strokeColor = '#ccc';
                    }
                    this.zr.modShape(shape.id, itemShape);
                }
            }
        },

        isSelected: function (itemName) {
            if (typeof this._selectedMap[itemName] != 'undefined') {
                return this._selectedMap[itemName];
            }
            else {
                // 没在legend里定义的都为true啊~
                return true;
            }
        },
        
        getSelectedMap: function () {
            return this._selectedMap;
        },
        
        setSelected: function(itemName, selectStatus) {
            if (this.legendOption.selectedMode === 'single') {
                for (var k in this._selectedMap) {
                    this._selectedMap[k] = false;
                }
            }
            this._selectedMap[itemName] = selectStatus;
            this.messageCenter.dispatch(
                ecConfig.EVENT.LEGEND_SELECTED,
                null,
                {
                    selected: this._selectedMap,
                    target: itemName
                },
                this.myChart
            );
        },
        
        /**
         * 图例选择
         */
        onlegendSelected: function (param, status) {
            var legendSelected = param.selected;
            for (var itemName in legendSelected) {
                if (this._selectedMap[itemName] != legendSelected[itemName]) {
                    // 有一项不一致都需要重绘
                    status.needRefresh = true;
                }
                this._selectedMap[itemName] = legendSelected[itemName];
            }
            return;
        }
    };
    
    var legendIcon = {
        line: function (ctx, style) {
            var dy = style.height / 2;
            ctx.moveTo(style.x,     style.y + dy);
            ctx.lineTo(style.x + style.width,style.y + dy);
        },
        
        pie: function (ctx, style) {
            var x = style.x;
            var y = style.y;
            var width = style.width;
            var height = style.height;
            SectorShape.prototype.buildPath(ctx, {
                x: x + width / 2,
                y: y + height + 2,
                r: height,
                r0: 6,
                startAngle: 45,
                endAngle: 135
            });
        },
        
        eventRiver: function (ctx, style) {
            var x = style.x;
            var y = style.y;
            var width = style.width;
            var height = style.height;
            ctx.moveTo(x, y + height);
            ctx.bezierCurveTo(
                x + width, y + height, x, y + 4, x + width, y + 4
            );
            ctx.lineTo(x + width, y);
            ctx.bezierCurveTo(
                x, y, x + width, y + height - 4, x, y + height - 4
            );
            ctx.lineTo(x, y + height);
        },
        
        k: function (ctx, style) {
            var x = style.x;
            var y = style.y;
            var width = style.width;
            var height = style.height;
            CandleShape.prototype.buildPath(ctx, {
                x: x + width / 2,
                y: [y + 1, y + 1, y + height - 6, y + height],
                width: width - 6
            });
        },
        
        bar: function (ctx, style) {
            var x = style.x;
            var y = style.y +1;
            var width = style.width;
            var height = style.height - 2;
            var r = 3;
            
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + width - r, y);
            ctx.quadraticCurveTo(
                x + width, y, x + width, y + r
            );
            ctx.lineTo(x + width, y + height - r);
            ctx.quadraticCurveTo(
                x + width, y + height, x + width - r, y + height
            );
            ctx.lineTo(x + r, y + height);
            ctx.quadraticCurveTo(
                x, y + height, x, y + height - r
            );
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
        },
        
        force: function (ctx, style) {
            IconShape.prototype.iconLibrary.circle(ctx, style);
        },
        
        radar: function (ctx, style) {
            var n = 6;
            var x = style.x + style.width / 2;
            var y = style.y + style.height / 2;
            var r = style.height / 2;

            var dStep = 2 * Math.PI / n;
            var deg = -Math.PI / 2;
            var xStart = x + r * Math.cos(deg);
            var yStart = y + r * Math.sin(deg);
            
            ctx.moveTo(xStart, yStart);
            deg += dStep;
            for (var i = 0, end = n - 1; i < end; i ++) {
                ctx.lineTo(x + r * Math.cos(deg), y + r * Math.sin(deg));
                deg += dStep;
            }
            ctx.lineTo(xStart, yStart);
        }
    };
    legendIcon.chord = legendIcon.pie;
    legendIcon.map = legendIcon.bar;
    
    for (var k in legendIcon) {
        IconShape.prototype.iconLibrary['legendicon' + k] = legendIcon[k];
    }
    
    zrUtil.inherits(Legend, Base);
    
    require('../component').define('legend', Legend);
    
    return Legend;
});
define('echarts/component/tooltip', ['require', './base', '../util/shape/Cross', 'zrender/shape/Line', 'zrender/shape/Rectangle', '../config', '../util/ecData', 'zrender/config', 'zrender/tool/event', 'zrender/tool/area', 'zrender/tool/color', 'zrender/tool/util', 'zrender/shape/Base', '../component'], function (require) {
    var Base = require('./base');
    
    // 图形依赖
    var CrossShape = require('../util/shape/Cross');
    var LineShape = require('zrender/shape/Line');
    var RectangleShape = require('zrender/shape/Rectangle');
    var rectangleInstance = new RectangleShape({});
    
    var ecConfig = require('../config');
    // 提示框
    ecConfig.tooltip = {
        zlevel: 1,                  // 一级层叠，频繁变化的tooltip指示器在pc上独立一层
        z: 8,                       // 二级层叠
        show: true,
        showContent: true,         // tooltip主体内容
        trigger: 'item',           // 触发类型，默认数据触发，见下图，可选为：'item' ¦ 'axis'
        // position: null          // 位置 {Array} | {Function}
        // formatter: null         // 内容格式器：{string}（Template） ¦ {Function}
        islandFormatter: '{a} <br/>{b} : {c}',  // 数据孤岛内容格式器
        showDelay: 20,             // 显示延迟，添加显示延迟可以避免频繁切换，单位ms
        hideDelay: 100,            // 隐藏延迟，单位ms
        transitionDuration: 0.4,   // 动画变换时间，单位s
        enterable: false,
        backgroundColor: 'rgba(0,0,0,0.7)',     // 提示背景颜色，默认为透明度为0.7的黑色
        borderColor: '#333',       // 提示边框颜色
        borderRadius: 4,           // 提示边框圆角，单位px，默认为4
        borderWidth: 0,            // 提示边框线宽，单位px，默认为0（无边框）
        padding: 5,                // 提示内边距，单位px，默认各方向内边距为5，
                                   // 接受数组分别设定上右下左边距，同css
        axisPointer: {             // 坐标轴指示器，坐标轴触发有效
            type: 'line',          // 默认为直线，可选为：'line' | 'shadow' | 'cross'
            lineStyle: {           // 直线指示器样式设置
                color: '#48b',
                width: 2,
                type: 'solid'
            },
            crossStyle: {
                color: '#1e90ff',
                width: 1,
                type: 'dashed'
            },
            shadowStyle: {                      // 阴影指示器样式设置
                color: 'rgba(150,150,150,0.3)', // 阴影颜色
                width: 'auto',                  // 阴影大小
                type: 'default'
            }
        },
        textStyle: {
            color: '#fff'
        }
    };

    var ecData = require('../util/ecData');
    var zrConfig = require('zrender/config');
    var zrEvent = require('zrender/tool/event');
    var zrArea = require('zrender/tool/area');
    var zrColor = require('zrender/tool/color');
    var zrUtil = require('zrender/tool/util');
    var zrShapeBase = require('zrender/shape/Base');

    /**
     * 构造函数
     * @param {Object} messageCenter echart消息中心
     * @param {ZRender} zr zrender实例
     * @param {Object} option 提示框参数
     * @param {HtmlElement} dom 目标对象
     * @param {ECharts} myChart 当前图表实例
     */
    function Tooltip(ecTheme, messageCenter, zr, option, myChart) {
        Base.call(this, ecTheme, messageCenter, zr, option, myChart);
        
        this.dom = myChart.dom;
        
        var self = this;
        self._onmousemove = function (param) {
            return self.__onmousemove(param);
        };
        self._onglobalout = function (param) {
            return self.__onglobalout(param);
        };
        
        this.zr.on(zrConfig.EVENT.MOUSEMOVE, self._onmousemove);
        this.zr.on(zrConfig.EVENT.GLOBALOUT, self._onglobalout);

        self._hide = function (param) {
            return self.__hide(param);
        };
        self._tryShow = function(param) {
            return self.__tryShow(param);
        };
        self._refixed = function(param) {
            return self.__refixed(param);
        };
        
        self._setContent = function(ticket, res) {
            return self.__setContent(ticket, res);
        };
        
        this._tDom = this._tDom || document.createElement('div');
        // 避免拖拽时页面选中的尴尬
        this._tDom.onselectstart = function() {
            return false;
        };
        this._tDom.onmouseover = function() {
            self._mousein = true;
        };
        this._tDom.onmouseout = function() {
            self._mousein = false;
        };
        this._tDom.className = 'echarts-tooltip';
        this._tDom.style.position = 'absolute';  // 不是多余的，别删！
        this.hasAppend = false;
        
        this._axisLineShape && this.zr.delShape(this._axisLineShape.id);
        this._axisLineShape = new LineShape({
            zlevel: this.getZlevelBase(),
            z: this.getZBase(),
            invisible: true,
            hoverable: false
        });
        this.shapeList.push(this._axisLineShape);
        this.zr.addShape(this._axisLineShape);
        
        this._axisShadowShape && this.zr.delShape(this._axisShadowShape.id);
        this._axisShadowShape = new LineShape({
            zlevel: this.getZlevelBase(),
            z: 1,                      // grid上，chart下
            invisible: true,
            hoverable: false
        });
        this.shapeList.push(this._axisShadowShape);
        this.zr.addShape(this._axisShadowShape);
        
        this._axisCrossShape && this.zr.delShape(this._axisCrossShape.id);
        this._axisCrossShape = new CrossShape({
            zlevel: this.getZlevelBase(),
            z: this.getZBase(),
            invisible: true,
            hoverable: false
        });
        this.shapeList.push(this._axisCrossShape);
        this.zr.addShape(this._axisCrossShape);
        
        this.showing = false;
        this.refresh(option);
    }
    
    Tooltip.prototype = {
        type: ecConfig.COMPONENT_TYPE_TOOLTIP,
        // 通用样式
        _gCssText: 'position:absolute;display:block;border-style:solid;white-space:nowrap;',
        /**
         * 根据配置设置dom样式
         */
        _style: function (opt) {
            if (!opt) {
                return '';
            }
            var cssText = [];
            if (opt.transitionDuration) {
                var transitionText = 'left ' + opt.transitionDuration + 's,'
                                    + 'top ' + opt.transitionDuration + 's';
                cssText.push(
                    'transition:' + transitionText
                );
                cssText.push(
                    '-moz-transition:' + transitionText
                );
                cssText.push(
                    '-webkit-transition:' + transitionText
                );
                cssText.push(
                    '-o-transition:' + transitionText
                );
            }

            if (opt.backgroundColor) {
                // for sb ie~
                cssText.push(
                    'background-Color:' + zrColor.toHex(
                        opt.backgroundColor
                    )
                );
                cssText.push('filter:alpha(opacity=70)');
                cssText.push('background-Color:' + opt.backgroundColor);
            }

            if (opt.borderWidth != null) {
                cssText.push('border-width:' + opt.borderWidth + 'px');
            }

            if (opt.borderColor != null) {
                cssText.push('border-color:' + opt.borderColor);
            }

            if (opt.borderRadius != null) {
                cssText.push(
                    'border-radius:' + opt.borderRadius + 'px'
                );
                cssText.push(
                    '-moz-border-radius:' + opt.borderRadius + 'px'
                );
                cssText.push(
                    '-webkit-border-radius:' + opt.borderRadius + 'px'
                );
                cssText.push(
                    '-o-border-radius:' + opt.borderRadius + 'px'
                );
            }

            var textStyle = opt.textStyle;
            if (textStyle) {
                textStyle.color && cssText.push('color:' + textStyle.color);
                textStyle.decoration && cssText.push(
                    'text-decoration:' + textStyle.decoration
                );
                textStyle.align && cssText.push(
                    'text-align:' + textStyle.align
                );
                textStyle.fontFamily && cssText.push(
                    'font-family:' + textStyle.fontFamily
                );
                textStyle.fontSize && cssText.push(
                    'font-size:' + textStyle.fontSize + 'px'
                );
                textStyle.fontSize && cssText.push(
                    'line-height:' + Math.round(textStyle.fontSize*3/2) + 'px'
                );
                textStyle.fontStyle && cssText.push(
                    'font-style:' + textStyle.fontStyle
                );
                textStyle.fontWeight && cssText.push(
                    'font-weight:' + textStyle.fontWeight
                );
            }


            var padding = opt.padding;
            if (padding != null) {
                padding = this.reformCssArray(padding);
                cssText.push(
                    'padding:' + padding[0] + 'px '
                               + padding[1] + 'px '
                               + padding[2] + 'px '
                               + padding[3] + 'px'
                );
            }

            cssText = cssText.join(';') + ';';

            return cssText;
        },
        
        __hide: function () {
            this._lastDataIndex = -1;
            this._lastSeriesIndex = -1;
            this._lastItemTriggerId = -1;
            if (this._tDom) {
                this._tDom.style.display = 'none';
            }
            var needRefresh = false;
            if (!this._axisLineShape.invisible) {
                this._axisLineShape.invisible = true;
                this.zr.modShape(this._axisLineShape.id);
                needRefresh = true;
            }
            if (!this._axisShadowShape.invisible) {
                this._axisShadowShape.invisible = true;
                this.zr.modShape(this._axisShadowShape.id);
                needRefresh = true;
            }
            if (!this._axisCrossShape.invisible) {
                this._axisCrossShape.invisible = true;
                this.zr.modShape(this._axisCrossShape.id);
                needRefresh = true;
            }
            if (this._lastTipShape && this._lastTipShape.tipShape.length > 0) {
                this.zr.delShape(this._lastTipShape.tipShape);
                this._lastTipShape = false;
                this.shapeList.length = 2;
            }
            needRefresh && this.zr.refreshNextFrame();
            this.showing = false;
        },
        
        _show: function (position, x, y, specialCssText) {
            var domHeight = this._tDom.offsetHeight;
            var domWidth = this._tDom.offsetWidth;
            if (position) {
                if (typeof position === 'function') {
                    position = position([x, y]);
                }
                if (position instanceof Array) {
                    x = position[0];
                    y = position[1];
                }
            }
            if (x + domWidth > this._zrWidth) {
                // 太靠右
                //x = this._zrWidth - domWidth;
                x -= (domWidth + 40);
            }
            if (y + domHeight > this._zrHeight) {
                // 太靠下
                //y = this._zrHeight - domHeight;
                y -= (domHeight - 20);
            }
            if (y < 20) {
                y = 0;
            }
            this._tDom.style.cssText = this._gCssText
                                  + this._defaultCssText
                                  + (specialCssText ? specialCssText : '')
                                  + 'left:' + x + 'px;top:' + y + 'px;';
            
            if (domHeight < 10 || domWidth < 10) {
                // this._zrWidth - x < 100 || this._zrHeight - y < 100
                setTimeout(this._refixed, 20);
            }
            this.showing = true;
        },
        
        __refixed: function () {
            if (this._tDom) {
                var cssText = '';
                var domHeight = this._tDom.offsetHeight;
                var domWidth = this._tDom.offsetWidth;
                if (this._tDom.offsetLeft + domWidth > this._zrWidth) {
                    cssText += 'left:' + (this._zrWidth - domWidth - 20) + 'px;';
                }
                if (this._tDom.offsetTop + domHeight > this._zrHeight) {
                    cssText += 'top:' + (this._zrHeight - domHeight - 10) + 'px;';
                }
                if (cssText !== '') {
                    this._tDom.style.cssText += cssText;
                }
            }
        },
        
        __tryShow: function () {
            var needShow;
            var trigger;
            if (!this._curTarget) {
                // 坐标轴事件
                this._findPolarTrigger() || this._findAxisTrigger();
            }
            else {
                // 数据项事件
                if (this._curTarget._type === 'island' && this.option.tooltip.show) {
                    this._showItemTrigger();
                    return;
                }
                var serie = ecData.get(this._curTarget, 'series');
                var data = ecData.get(this._curTarget, 'data');
                needShow = this.deepQuery(
                    [data, serie, this.option],
                    'tooltip.show'
                );
                if (serie == null || data == null || !needShow) {
                    // 不响应tooltip的数据对象延时隐藏
                    clearTimeout(this._hidingTicket);
                    clearTimeout(this._showingTicket);
                    this._hidingTicket = setTimeout(this._hide, this._hideDelay);
                }
                else {
                    trigger = this.deepQuery(
                        [data, serie, this.option],
                        'tooltip.trigger'
                    );
                    
                    trigger === 'axis'
                                ? this._showAxisTrigger(
                                      serie.xAxisIndex, serie.yAxisIndex,
                                      ecData.get(this._curTarget, 'dataIndex')
                                  )
                                : this._showItemTrigger();
                }
            }
        },

        /**
         * 直角系 
         */
        _findAxisTrigger: function () {
            if (!this.component.xAxis || !this.component.yAxis) {
                this._hidingTicket = setTimeout(this._hide, this._hideDelay);
                return;
            }
            var series = this.option.series;
            var xAxisIndex;
            var yAxisIndex;
            for (var i = 0, l = series.length; i < l; i++) {
                // 找到第一个axis触发tooltip的系列
                if (this.deepQuery([series[i], this.option], 'tooltip.trigger') === 'axis') {
                    xAxisIndex = series[i].xAxisIndex || 0;
                    yAxisIndex = series[i].yAxisIndex || 0;
                    if (this.component.xAxis.getAxis(xAxisIndex)
                        && this.component.xAxis.getAxis(xAxisIndex).type
                           === ecConfig.COMPONENT_TYPE_AXIS_CATEGORY
                    ) {
                        // 横轴为类目轴
                        this._showAxisTrigger(xAxisIndex, yAxisIndex,
                            this._getNearestDataIndex(
                                'x', this.component.xAxis.getAxis(xAxisIndex)
                            )
                        );
                        return;
                    } 
                    else if (this.component.yAxis.getAxis(yAxisIndex)
                             && this.component.yAxis.getAxis(yAxisIndex).type
                                === ecConfig.COMPONENT_TYPE_AXIS_CATEGORY
                    ) {
                        // 纵轴为类目轴
                        this._showAxisTrigger(xAxisIndex, yAxisIndex,
                            this._getNearestDataIndex(
                                'y', this.component.yAxis.getAxis(yAxisIndex)
                            )
                        );
                        return;
                    }
                    else {
                        // 双数值轴
                        this._showAxisTrigger(xAxisIndex, yAxisIndex, -1);
                        return;
                    }
                }
            }
            if (this.option.tooltip.axisPointer.type === 'cross') {
                this._showAxisTrigger(-1, -1, -1);
            }
        },
        
        /**
         * 极坐标 
         */
        _findPolarTrigger: function () {
            if (!this.component.polar) {
                return false;
            }
            var x = zrEvent.getX(this._event);
            var y = zrEvent.getY(this._event);
            var polarIndex = this.component.polar.getNearestIndex([x, y]);
            var valueIndex;
            if (polarIndex) {
                valueIndex = polarIndex.valueIndex;
                polarIndex = polarIndex.polarIndex;
            }
            else {
                polarIndex = -1;
            }
            
            if (polarIndex != -1) {
                return this._showPolarTrigger(polarIndex, valueIndex);
            }
            
            return false;
        },
        
        /**
         * 根据坐标轴事件带的属性获取最近的axisDataIndex
         */
        _getNearestDataIndex: function (direction, categoryAxis) {
            var dataIndex = -1;
            var x = zrEvent.getX(this._event);
            var y = zrEvent.getY(this._event);
            if (direction === 'x') {
                // 横轴为类目轴
                var left;
                var right;
                var xEnd = this.component.grid.getXend();
                var curCoord = categoryAxis.getCoordByIndex(dataIndex);
                while (curCoord < xEnd) {
                    right = curCoord;
                    if (curCoord <= x) {
                        left = curCoord;
                    }
                    else {
                        break;
                    }
                    curCoord = categoryAxis.getCoordByIndex(++dataIndex);
                }
                if (dataIndex <= 0) {
                    dataIndex = 0;
                }
                else if (x - left <= right - x) {
                    dataIndex -= 1;
                }
                else {
                    // 离右边近，看是否为最后一个
                    if (categoryAxis.getNameByIndex(dataIndex) == null) {
                        dataIndex -= 1;
                    }
                }
                return dataIndex;
            }
            else {
                // 纵轴为类目轴
                var top;
                var bottom;
                var yStart = this.component.grid.getY();
                var curCoord = categoryAxis.getCoordByIndex(dataIndex);
                while (curCoord > yStart) {
                    top = curCoord;
                    if (curCoord >= y) {
                        bottom = curCoord;
                    }
                    else {
                        break;
                    }
                    curCoord = categoryAxis.getCoordByIndex(++dataIndex);
                }

                if (dataIndex <= 0) {
                    dataIndex = 0;
                }
                else if (y - top >= bottom - y) {
                    dataIndex -= 1;
                }
                else {
                    // 离上方边近，看是否为最后一个
                    if (categoryAxis.getNameByIndex(dataIndex) == null) {
                        dataIndex -= 1;
                    }
                }
                return dataIndex;
            }
            return -1;
        },

        /**
         * 直角系 
         */
        _showAxisTrigger: function (xAxisIndex, yAxisIndex, dataIndex) {
            !this._event.connectTrigger && this.messageCenter.dispatch(
                ecConfig.EVENT.TOOLTIP_IN_GRID,
                this._event,
                null,
                this.myChart
            );
            if (this.component.xAxis == null
                || this.component.yAxis == null
                || xAxisIndex == null
                || yAxisIndex == null
                // || dataIndex < 0
            ) {
                // 不响应tooltip的数据对象延时隐藏
                clearTimeout(this._hidingTicket);
                clearTimeout(this._showingTicket);
                this._hidingTicket = setTimeout(this._hide, this._hideDelay);
                return;
            }
            var series = this.option.series;
            var seriesArray = [];
            var seriesIndex = [];
            var categoryAxis;

            var formatter;
            var position;
            var showContent;
            var specialCssText = '';
            if (this.option.tooltip.trigger === 'axis') {
                if (!this.option.tooltip.show) {
                    return;
                }
                formatter = this.option.tooltip.formatter;
                position = this.option.tooltip.position;
            }

            var axisLayout = xAxisIndex != -1
                             && this.component.xAxis.getAxis(xAxisIndex).type
                                === ecConfig.COMPONENT_TYPE_AXIS_CATEGORY
                             ? 'xAxis'      // 横轴为类目轴，找到所有用这条横轴并且axis触发的系列数据
                             : yAxisIndex != -1
                               && this.component.yAxis.getAxis(yAxisIndex).type
                                  === ecConfig.COMPONENT_TYPE_AXIS_CATEGORY
                               ? 'yAxis'    // 纵轴为类目轴，找到所有用这条纵轴并且axis触发的系列数据
                               : false;
            var x;
            var y;
            if (axisLayout) {
                var axisIndex = axisLayout == 'xAxis' ? xAxisIndex : yAxisIndex;
                categoryAxis = this.component[axisLayout].getAxis(axisIndex);
                for (var i = 0, l = series.length; i < l; i++) {
                    if (!this._isSelected(series[i].name)) {
                        continue;
                    }
                    if (series[i][axisLayout + 'Index'] === axisIndex
                        && this.deepQuery([series[i], this.option], 'tooltip.trigger') === 'axis'
                    ) {
                        showContent = this.query(series[i], 'tooltip.showContent') 
                                      || showContent;
                        formatter = this.query(series[i], 'tooltip.formatter') 
                                    || formatter;
                        position = this.query(series[i], 'tooltip.position') 
                                   || position;
                        
                        specialCssText += this._style(this.query(series[i], 'tooltip'));
                        if (series[i].stack != null && axisLayout == 'xAxis') {
                            seriesArray.unshift(series[i]);
                            seriesIndex.unshift(i);
                        }
                        else {
                            seriesArray.push(series[i]);
                            seriesIndex.push(i);
                        }
                    }
                }
                
                // 寻找高亮元素
                this.messageCenter.dispatch(
                    ecConfig.EVENT.TOOLTIP_HOVER,
                    this._event,
                    {
                        seriesIndex: seriesIndex,
                        dataIndex: dataIndex
                    },
                    this.myChart
                );
                
                var rect;
                if (axisLayout == 'xAxis') {
                    x = this.subPixelOptimize(
                        categoryAxis.getCoordByIndex(dataIndex),
                        this._axisLineWidth
                    );
                    y = zrEvent.getY(this._event);
                    rect = [
                        x, this.component.grid.getY(), 
                        x, this.component.grid.getYend()
                    ];
                }
                else {
                    x = zrEvent.getX(this._event);
                    y = this.subPixelOptimize(
                        categoryAxis.getCoordByIndex(dataIndex),
                        this._axisLineWidth
                    );
                    rect = [
                        this.component.grid.getX(), y, 
                        this.component.grid.getXend(), y
                    ];
                }
                this._styleAxisPointer(
                    seriesArray,
                    rect[0], rect[1], rect[2], rect[3],
                    categoryAxis.getGap(), x, y
                );
            }
            else {
                // 双数值轴
                x = zrEvent.getX(this._event);
                y = zrEvent.getY(this._event);
                this._styleAxisPointer(
                    series,
                    this.component.grid.getX(), y, 
                    this.component.grid.getXend(), y,
                    0, x, y
                );
                if (dataIndex >= 0) {
                    this._showItemTrigger(true);
                }
                else {
                    clearTimeout(this._hidingTicket);
                    clearTimeout(this._showingTicket);
                    this._tDom.style.display = 'none';
                }
            }

            if (seriesArray.length > 0) {
                // 复位item trigger和axis trigger间短距离来回变换时的不响应
                this._lastItemTriggerId = -1;
                // 相同dataIndex seriesIndex时不再触发内容更新
                if (this._lastDataIndex != dataIndex || this._lastSeriesIndex != seriesIndex[0]) {
                    this._lastDataIndex = dataIndex;
                    this._lastSeriesIndex = seriesIndex[0];
                    var data;
                    var value;
                    if (typeof formatter === 'function') {
                        var params = [];
                        for (var i = 0, l = seriesArray.length; i < l; i++) {
                            data = seriesArray[i].data[dataIndex];
                            value = this.getDataFromOption(data, '-');
                            
                            params.push({
                                seriesIndex: seriesIndex[i],
                                seriesName: seriesArray[i].name || '',
                                series: seriesArray[i],
                                dataIndex: dataIndex,
                                data: data,
                                name: categoryAxis.getNameByIndex(dataIndex),
                                value: value,
                                // 向下兼容
                                0: seriesArray[i].name || '',
                                1: categoryAxis.getNameByIndex(dataIndex),
                                2: value,
                                3: data
                            });
                        }
                        this._curTicket = 'axis:' + dataIndex;
                        this._tDom.innerHTML = formatter.call(
                            this.myChart, params, this._curTicket, this._setContent
                        );
                    }
                    else if (typeof formatter === 'string') {
                        this._curTicket = NaN;
                        formatter = formatter.replace('{a}','{a0}')
                                             .replace('{b}','{b0}')
                                             .replace('{c}','{c0}');
                        for (var i = 0, l = seriesArray.length; i < l; i++) {
                            formatter = formatter.replace(
                                '{a' + i + '}',
                                this._encodeHTML(seriesArray[i].name || '')
                            );
                            formatter = formatter.replace(
                                '{b' + i + '}',
                                this._encodeHTML(categoryAxis.getNameByIndex(dataIndex))
                            );
                            data = seriesArray[i].data[dataIndex];
                            data = this.getDataFromOption(data, '-');
                            formatter = formatter.replace(
                                '{c' + i + '}',
                                data instanceof Array 
                                ? data : this.numAddCommas(data)
                            );
                        }
                        this._tDom.innerHTML = formatter;
                    }
                    else {
                        this._curTicket = NaN;
                        formatter = this._encodeHTML(
                            categoryAxis.getNameByIndex(dataIndex)
                        );
    
                        for (var i = 0, l = seriesArray.length; i < l; i++) {
                            formatter += '<br/>' 
                                         + this._encodeHTML(seriesArray[i].name || '')
                                         + ' : ';
                            data = seriesArray[i].data[dataIndex];
                            data = this.getDataFromOption(data, '-');
                            formatter += data instanceof Array 
                                         ? data : this.numAddCommas(data);
                        }
                        this._tDom.innerHTML = formatter;
                    }
                }

                // don't modify, just false, showContent == undefined == true
                if (showContent === false || !this.option.tooltip.showContent) {
                    // 只用tooltip的行为，不显示主体
                    return;
                }
                
                if (!this.hasAppend) {
                    this._tDom.style.left = this._zrWidth / 2 + 'px';
                    this._tDom.style.top = this._zrHeight / 2 + 'px';
                    this.dom.firstChild.appendChild(this._tDom);
                    this.hasAppend = true;
                }
                this._show(position, x + 10, y + 10, specialCssText);
            }
        },
        
        /**
         * 极坐标 
         */
        _showPolarTrigger: function (polarIndex, dataIndex) {
            if (this.component.polar == null
                || polarIndex == null
                || dataIndex == null
                || dataIndex < 0
            ) {
                return false;
            }
            var series = this.option.series;
            var seriesArray = [];
            var seriesIndex = [];

            var formatter;
            var position;
            var showContent;
            var specialCssText = '';
            if (this.option.tooltip.trigger === 'axis') {
                if (!this.option.tooltip.show) {
                    return false;
                }
                formatter = this.option.tooltip.formatter;
                position = this.option.tooltip.position;
            }
            var indicatorName = this.option.polar[polarIndex].indicator[dataIndex].text;

            // 找到所有用这个极坐标并且axis触发的系列数据
            for (var i = 0, l = series.length; i < l; i++) {
                if (!this._isSelected(series[i].name)) {
                    continue;
                }
                if (series[i].polarIndex === polarIndex
                    && this.deepQuery([series[i], this.option], 'tooltip.trigger') === 'axis'
                ) {
                    showContent = this.query(series[i], 'tooltip.showContent') 
                                  || showContent;
                    formatter = this.query(series[i], 'tooltip.formatter') 
                                || formatter;
                    position = this.query(series[i], 'tooltip.position') 
                               || position;
                    specialCssText += this._style(this.query(series[i], 'tooltip'));
                    seriesArray.push(series[i]);
                    seriesIndex.push(i);
                }
            }
            if (seriesArray.length > 0) {
                var polarData;
                var data;
                var value;
                var params = [];

                for (var i = 0, l = seriesArray.length; i < l; i++) {
                    polarData = seriesArray[i].data;
                    for (var j = 0, k = polarData.length; j < k; j++) {
                        data = polarData[j];
                        if (!this._isSelected(data.name)) {
                            continue;
                        }
                        data = data != null
                               ? data
                               : {name:'', value: {dataIndex:'-'}};
                        value = this.getDataFromOption(data.value[dataIndex]);
                        params.push({
                            seriesIndex: seriesIndex[i],
                            seriesName: seriesArray[i].name || '',
                            series: seriesArray[i],
                            dataIndex: dataIndex,
                            data: data,
                            name: data.name,
                            indicator: indicatorName,
                            value: value,
                            // 向下兼容
                            0: seriesArray[i].name || '',
                            1: data.name,
                            2: value,
                            3: indicatorName
                        });
                    }
                }
                if (params.length <= 0) {
                    return;
                }
                // 复位item trigger和axis trigger间短距离来回变换时的不响应
                this._lastItemTriggerId = -1;

                // 相同dataIndex seriesIndex时不再触发内容更新
                if (this._lastDataIndex != dataIndex || this._lastSeriesIndex != seriesIndex[0]) {
                    this._lastDataIndex = dataIndex;
                    this._lastSeriesIndex = seriesIndex[0];
                    if (typeof formatter === 'function') {
                        this._curTicket = 'axis:' + dataIndex;
                        this._tDom.innerHTML = formatter.call(
                            this.myChart, params, this._curTicket, this._setContent
                        );
                    }
                    else if (typeof formatter === 'string') {
                        formatter = formatter.replace('{a}','{a0}')
                                             .replace('{b}','{b0}')
                                             .replace('{c}','{c0}')
                                             .replace('{d}','{d0}');
                        for (var i = 0, l = params.length; i < l; i++) {
                            formatter = formatter.replace(
                                '{a' + i + '}',
                                this._encodeHTML(params[i].seriesName)
                            );
                            formatter = formatter.replace(
                                '{b' + i + '}',
                                this._encodeHTML(params[i].name)
                            );
                            formatter = formatter.replace(
                                '{c' + i + '}',
                                this.numAddCommas(params[i].value)
                            );
                            formatter = formatter.replace(
                                '{d' + i + '}',
                                this._encodeHTML(params[i].indicator)
                            );
                        }
                        this._tDom.innerHTML = formatter;
                    }
                    else {
                        formatter = this._encodeHTML(params[0].name) + '<br/>' 
                                    + this._encodeHTML(params[0].indicator) + ' : ' 
                                    + this.numAddCommas(params[0].value);
                        for (var i = 1, l = params.length; i < l; i++) {
                            formatter += '<br/>' + this._encodeHTML(params[i].name) 
                                         + '<br/>';
                            formatter += this._encodeHTML(params[i].indicator) + ' : ' 
                                         + this.numAddCommas(params[i].value);
                        }
                        this._tDom.innerHTML = formatter;
                    }
                }

                // don't modify, just false, showContent == undefined == true
                if (showContent === false || !this.option.tooltip.showContent) {
                    // 只用tooltip的行为，不显示主体
                    return;
                }
                
                if (!this.hasAppend) {
                    this._tDom.style.left = this._zrWidth / 2 + 'px';
                    this._tDom.style.top = this._zrHeight / 2 + 'px';
                    this.dom.firstChild.appendChild(this._tDom);
                    this.hasAppend = true;
                }
                this._show(
                    position,
                    zrEvent.getX(this._event), 
                    zrEvent.getY(this._event), 
                    specialCssText
                );
                return true;
            }
        },
        
        /**
         * @parma {boolean} axisTrigger 
         */
        _showItemTrigger: function (axisTrigger) {
            if (!this._curTarget) {
                return;
            }
            var serie = ecData.get(this._curTarget, 'series');
            var seriesIndex = ecData.get(this._curTarget, 'seriesIndex');
            var data = ecData.get(this._curTarget, 'data');
            var dataIndex = ecData.get(this._curTarget, 'dataIndex');
            var name = ecData.get(this._curTarget, 'name');
            var value = ecData.get(this._curTarget, 'value');
            var special = ecData.get(this._curTarget, 'special');
            var special2 = ecData.get(this._curTarget, 'special2');
            var queryTarget = [data, serie, this.option];
            // 从低优先级往上找到trigger为item的formatter和样式
            var formatter;
            var position;
            var showContent;
            var specialCssText = '';
            if (this._curTarget._type != 'island') {
                // 全局
                var trigger = axisTrigger ? 'axis' : 'item';
                if (this.option.tooltip.trigger === trigger) {
                    formatter = this.option.tooltip.formatter;
                    position = this.option.tooltip.position;
                }
                // 系列
                if (this.query(serie, 'tooltip.trigger') === trigger) {
                    showContent = this.query(serie, 'tooltip.showContent') || showContent;
                    formatter = this.query(serie, 'tooltip.formatter') || formatter;
                    position = this.query(serie, 'tooltip.position') || position;
                    specialCssText += this._style(this.query(serie, 'tooltip'));
                }
                // 数据项
                showContent = this.query(data, 'tooltip.showContent') || showContent;
                formatter = this.query(data, 'tooltip.formatter') || formatter;
                position = this.query(data, 'tooltip.position') || position;
                specialCssText += this._style(this.query(data, 'tooltip'));
            }
            else {
                this._lastItemTriggerId = NaN;
                showContent = this.deepQuery(queryTarget, 'tooltip.showContent');
                formatter = this.deepQuery(queryTarget, 'tooltip.islandFormatter');
                position = this.deepQuery(queryTarget, 'tooltip.islandPosition');
            }

            // 复位item trigger和axis trigger间短距离来回变换时的不响应
            this._lastDataIndex = -1;
            this._lastSeriesIndex = -1;

            // 相同dataIndex seriesIndex时不再触发内容更新
            if (this._lastItemTriggerId !== this._curTarget.id) {
                this._lastItemTriggerId = this._curTarget.id;
                if (typeof formatter === 'function') {
                    this._curTicket = (serie.name || '') + ':' + dataIndex;
                    this._tDom.innerHTML = formatter.call(
                        this.myChart,
                        {
                            seriesIndex: seriesIndex,
                            seriesName: serie.name || '',
                            series: serie,
                            dataIndex: dataIndex,
                            data: data,
                            name: name,
                            value: value,
                            percent: special,   // 饼图
                            indicator: special, // 雷达图
                            value2: special2,
                            indicator2: special2,
                            // 向下兼容
                            0: serie.name || '',
                            1: name,
                            2: value,
                            3: special,
                            4: special2,
                            5: data,
                            6: seriesIndex,
                            7: dataIndex
                        },
                        this._curTicket,
                        this._setContent
                    );
                }
                else if (typeof formatter === 'string') {
                    this._curTicket = NaN;
                    formatter = formatter.replace('{a}', '{a0}')
                                         .replace('{b}', '{b0}')
                                         .replace('{c}', '{c0}');
                    formatter = formatter.replace('{a0}', this._encodeHTML(serie.name || ''))
                                         .replace('{b0}', this._encodeHTML(name))
                                         .replace(
                                             '{c0}',
                                             value instanceof Array ? value : this.numAddCommas(value)
                                         );
    
                    formatter = formatter.replace('{d}', '{d0}')
                                         .replace('{d0}', special || '');
                    formatter = formatter.replace('{e}', '{e0}')
                                         .replace(
                                             '{e0}',
                                             ecData.get(this._curTarget, 'special2') || ''
                                         );
    
                    this._tDom.innerHTML = formatter;
                }
                else {
                    this._curTicket = NaN;
                    if (serie.type === ecConfig.CHART_TYPE_RADAR && special) {
                        this._tDom.innerHTML = this._itemFormatter.radar.call(
                            this, serie, name, value, special
                        );
                    }
                    // chord 处理暂时跟 force 一样
                    // else if (serie.type === ecConfig.CHART_TYPE_CHORD) {
                    //     this._tDom.innerHTML = this._itemFormatter.chord.call(
                    //         this, serie, name, value, special, special2
                    //     );
                    // }
                    else if (serie.type === ecConfig.CHART_TYPE_EVENTRIVER) {
                        this._tDom.innerHTML = this._itemFormatter.eventRiver.call(
                            this, serie, name, value, data
                        );
                    }
                    else {
                        this._tDom.innerHTML = ''
                            + (serie.name != null ? (this._encodeHTML(serie.name) + '<br/>') : '')
                            + (name === '' ? '' : (this._encodeHTML(name) + ' : '))
                            + (value instanceof Array ? value : this.numAddCommas(value));
                    }
                }
            }

            var x = zrEvent.getX(this._event);
            var y = zrEvent.getY(this._event);
            if (this.deepQuery(queryTarget, 'tooltip.axisPointer.show') 
                && this.component.grid
            ) {
                this._styleAxisPointer(
                    [serie],
                    this.component.grid.getX(), y, 
                    this.component.grid.getXend(), y,
                    0, x, y
                );
            }
            else {
                this._hide();
            }
            
            // don't modify, just false, showContent == undefined == true
            if (showContent === false || !this.option.tooltip.showContent) {
                // 只用tooltip的行为，不显示主体
                return;
            }
            
            if (!this.hasAppend) {
                this._tDom.style.left = this._zrWidth / 2 + 'px';
                this._tDom.style.top = this._zrHeight / 2 + 'px';
                this.dom.firstChild.appendChild(this._tDom);
                this.hasAppend = true;
            }
            
            this._show(position, x + 20, y - 20, specialCssText);
        },

        _itemFormatter: {
            radar: function(serie, name, value, indicator){
                var html = '';
                html += this._encodeHTML(name === '' ? (serie.name || '') : name);
                html += html === '' ? '' : '<br />';
                for (var i = 0 ; i < indicator.length; i ++) {
                    html += this._encodeHTML(indicator[i].text) + ' : ' 
                            + this.numAddCommas(value[i]) + '<br />';
                }
                return html;
            },
            chord: function(serie, name, value, special, special2) {
                if (special2 == null) {
                    // 外环上
                    return this._encodeHTML(name) + ' (' + this.numAddCommas(value) + ')';
                }
                else {
                    var name1 = this._encodeHTML(name);
                    var name2 = this._encodeHTML(special);
                    // 内部弦上
                    return ''
                        + (serie.name != null ? (this._encodeHTML(serie.name) + '<br/>') : '')
                        + name1 + ' -> ' + name2 
                        + ' (' + this.numAddCommas(value) + ')'
                        + '<br />'
                        + name2 + ' -> ' + name1
                        + ' (' + this.numAddCommas(special2) + ')';
                }
            },
            eventRiver: function(serie, name, value, data) {
                var html = '';
                html += this._encodeHTML(serie.name === '' ? '' : (serie.name + ' : ') );
                html += this._encodeHTML(name);
                html += html === '' ? '' : '<br />';
                data = data.evolution;
                for (var i = 0, l = data.length; i < l; i++) {
                    html += '<div style="padding-top:5px;">';
                    if (!data[i].detail) {
                        continue;
                    }
                    if (data[i].detail.img) {
                        html += '<img src="' + data[i].detail.img 
                                + '" style="float:left;width:40px;height:40px;">';
                    }
                    html += '<div style="margin-left:45px;">' + data[i].time + '<br/>';
                    html += '<a href="' + data[i].detail.link + '" target="_blank">';
                    html += data[i].detail.text + '</a></div>';
                    html += '</div>';
                }
                return html;
            }
        },
        
        /**
         * 设置坐标轴指示器样式 
         */
        _styleAxisPointer: function (seriesArray, xStart, yStart, xEnd, yEnd, gap, x, y) {
            if (seriesArray.length > 0) {
                var queryTarget;
                var curType;
                var axisPointer = this.option.tooltip.axisPointer;
                var pointType = axisPointer.type;
                var style = {
                    line: {},
                    cross: {},
                    shadow: {}
                };
                for (var pType in style) {
                    style[pType].color = axisPointer[pType + 'Style'].color;
                    style[pType].width = axisPointer[pType + 'Style'].width;
                    style[pType].type = axisPointer[pType + 'Style'].type;
                }
                for (var i = 0, l = seriesArray.length; i < l; i++) {
                    //if (this.deepQuery([seriesArray[i], this.option], 'tooltip.trigger') === 'axis') {
                        queryTarget = seriesArray[i];
                        curType = this.query(queryTarget, 'tooltip.axisPointer.type');
                        pointType = curType || pointType; 
                        if (curType) {
                            style[curType].color = this.query(
                                queryTarget,
                                'tooltip.axisPointer.' + curType + 'Style.color'
                            ) || style[curType].color;
                            style[curType].width = this.query(
                                queryTarget,
                                'tooltip.axisPointer.' + curType + 'Style.width'
                            ) || style[curType].width;
                            style[curType].type = this.query(
                                queryTarget,
                                'tooltip.axisPointer.' + curType + 'Style.type'
                            ) || style[curType].type;
                        }
                    //}
                }
                
                if (pointType === 'line') {
                    var lineWidth = style.line.width;
                    var isVertical = xStart == xEnd;
                    this._axisLineShape.style = {
                        xStart: isVertical ? this.subPixelOptimize(xStart, lineWidth) : xStart,
                        yStart: isVertical ? yStart : this.subPixelOptimize(yStart, lineWidth),
                        xEnd: isVertical ? this.subPixelOptimize(xEnd, lineWidth) : xEnd,
                        yEnd: isVertical ? yEnd : this.subPixelOptimize(yEnd, lineWidth),
                        strokeColor: style.line.color,
                        lineWidth: lineWidth,
                        lineType: style.line.type
                    };
                    this._axisLineShape.invisible = false;
                    this.zr.modShape(this._axisLineShape.id);
                }
                else if (pointType === 'cross') {
                    var crossWidth = style.cross.width;
                    this._axisCrossShape.style = {
                        brushType: 'stroke',
                        rect: this.component.grid.getArea(),
                        x: this.subPixelOptimize(x, crossWidth),
                        y: this.subPixelOptimize(y, crossWidth),
                        text: ('( ' 
                               + this.component.xAxis.getAxis(0).getValueFromCoord(x)
                               + ' , '
                               + this.component.yAxis.getAxis(0).getValueFromCoord(y) 
                               + ' )'
                              ).replace('  , ', ' ').replace(' ,  ', ' '),
                        textPosition: 'specific',
                        strokeColor: style.cross.color,
                        lineWidth: crossWidth,
                        lineType: style.cross.type
                    };
                    if (this.component.grid.getXend() - x > 100) {          // 右侧有空间
                        this._axisCrossShape.style.textAlign = 'left';
                        this._axisCrossShape.style.textX = x + 10;
                    }
                    else {
                        this._axisCrossShape.style.textAlign = 'right';
                        this._axisCrossShape.style.textX = x - 10;
                    }
                    if (y - this.component.grid.getY() > 50) {             // 上方有空间
                        this._axisCrossShape.style.textBaseline = 'bottom';
                        this._axisCrossShape.style.textY = y - 10;
                    }
                    else {
                        this._axisCrossShape.style.textBaseline = 'top';
                        this._axisCrossShape.style.textY = y + 10;
                    }
                    this._axisCrossShape.invisible = false;
                    this.zr.modShape(this._axisCrossShape.id);
                }
                else if (pointType === 'shadow') {
                    if (style.shadow.width == null 
                        || style.shadow.width === 'auto'
                        || isNaN(style.shadow.width)
                    ) {
                        style.shadow.width = gap;
                    }
                    if (xStart === xEnd) {
                        // 纵向
                        if (Math.abs(this.component.grid.getX() - xStart) < 2) {
                            // 最左边
                            style.shadow.width /= 2;
                            xStart = xEnd = xEnd + style.shadow.width / 2;
                        }
                        else if (Math.abs(this.component.grid.getXend() - xStart) < 2) {
                            // 最右边
                            style.shadow.width /= 2;
                            xStart = xEnd = xEnd - style.shadow.width / 2;
                        }
                    }
                    else if (yStart === yEnd) {
                        // 横向
                        if (Math.abs(this.component.grid.getY() - yStart) < 2) {
                            // 最上边
                            style.shadow.width /= 2;
                            yStart = yEnd = yEnd + style.shadow.width / 2;
                        }
                        else if (Math.abs(this.component.grid.getYend() - yStart) < 2) {
                            // 最右边
                            style.shadow.width /= 2;
                            yStart = yEnd = yEnd - style.shadow.width / 2;
                        }
                    }
                    this._axisShadowShape.style = {
                        xStart: xStart,
                        yStart: yStart,
                        xEnd: xEnd,
                        yEnd: yEnd,
                        strokeColor: style.shadow.color,
                        lineWidth: style.shadow.width
                    };
                    this._axisShadowShape.invisible = false;
                    this.zr.modShape(this._axisShadowShape.id);
                }
                this.zr.refreshNextFrame();
            }
        },

        __onmousemove: function (param) {
            clearTimeout(this._hidingTicket);
            clearTimeout(this._showingTicket);
            if (this._mousein && this._enterable) {
                return;
            }
            var target = param.target;
            var mx = zrEvent.getX(param.event);
            var my = zrEvent.getY(param.event);
            if (!target) {
                // 判断是否落到直角系里，axis触发的tooltip
                this._curTarget = false;
                this._event = param.event;
                // this._event._target = this._event.target || this._event.toElement;
                this._event.zrenderX = mx;
                this._event.zrenderY = my;
                if (this._needAxisTrigger 
                    && this.component.grid 
                    && zrArea.isInside(rectangleInstance, this.component.grid.getArea(), mx, my)
                ) {
                    this._showingTicket = setTimeout(this._tryShow, this._showDelay);
                }
                else if (this._needAxisTrigger 
                        && this.component.polar 
                        && this.component.polar.isInside([mx, my]) != -1
                ) {
                    this._showingTicket = setTimeout(this._tryShow, this._showDelay);
                }
                else {
                    !this._event.connectTrigger && this.messageCenter.dispatch(
                        ecConfig.EVENT.TOOLTIP_OUT_GRID,
                        this._event,
                        null,
                        this.myChart
                    );
                    this._hidingTicket = setTimeout(this._hide, this._hideDelay);
                }
            }
            else {
                this._curTarget = target;
                this._event = param.event;
                // this._event._target = this._event.target || this._event.toElement;
                this._event.zrenderX = mx;
                this._event.zrenderY = my;
                var polarIndex;
                if (this._needAxisTrigger 
                    && this.component.polar 
                    && (polarIndex = this.component.polar.isInside([mx, my])) != -1
                ) {
                    // 看用这个polar的系列数据是否是axis触发，如果是设置_curTarget为nul
                    var series = this.option.series;
                    for (var i = 0, l = series.length; i < l; i++) {
                        if (series[i].polarIndex === polarIndex
                            && this.deepQuery(
                                   [series[i], this.option], 'tooltip.trigger'
                               ) === 'axis'
                        ) {
                            this._curTarget = null;
                            break;
                        }
                    }
                   
                }
                this._showingTicket = setTimeout(this._tryShow, this._showDelay);
            }
        },

        /**
         * zrender事件响应：鼠标离开绘图区域
         */
        __onglobalout: function () {
            clearTimeout(this._hidingTicket);
            clearTimeout(this._showingTicket);
            this._hidingTicket = setTimeout(this._hide, this._hideDelay);
        },
        
        /**
         * 异步回调填充内容
         */
        __setContent: function (ticket, content) {
            if (!this._tDom) {
                return;
            }
            if (ticket === this._curTicket) {
                this._tDom.innerHTML = content;
            }
            
            setTimeout(this._refixed, 20);
        },

        ontooltipHover: function (param, tipShape) {
            if (!this._lastTipShape // 不存在或者存在但dataIndex发生变化才需要重绘
                || (this._lastTipShape && this._lastTipShape.dataIndex != param.dataIndex)
            ) {
                if (this._lastTipShape && this._lastTipShape.tipShape.length > 0) {
                    this.zr.delShape(this._lastTipShape.tipShape);
                    this.shapeList.length = 2;
                }
                for (var i = 0, l = tipShape.length; i < l; i++) {
                    tipShape[i].zlevel = this.getZlevelBase();
                    tipShape[i].z = this.getZBase();
                    
                    tipShape[i].style = zrShapeBase.prototype.getHighlightStyle(
                        tipShape[i].style,
                        tipShape[i].highlightStyle
                    );
                    tipShape[i].draggable = false;
                    tipShape[i].hoverable = false;
                    tipShape[i].clickable = false;
                    tipShape[i].ondragend = null;
                    tipShape[i].ondragover = null;
                    tipShape[i].ondrop = null;
                    this.shapeList.push(tipShape[i]);
                    this.zr.addShape(tipShape[i]);
                }
                this._lastTipShape = {
                    dataIndex: param.dataIndex,
                    tipShape: tipShape
                };
            }
        },
        
        ondragend: function () {
            this._hide();
        },
        
        /**
         * 图例选择
         */
        onlegendSelected: function (param) {
            this._selectedMap = param.selected;
        },
        
        _setSelectedMap: function () {
            if (this.component.legend) {
                this._selectedMap = zrUtil.clone(this.component.legend.getSelectedMap());
            }
            else {
                this._selectedMap = {};
            }
        },
        
        _isSelected: function (itemName) {
            if (this._selectedMap[itemName] != null) {
                return this._selectedMap[itemName];
            }
            else {
                return true; // 没在legend里定义的都为true啊~
            }
        },

        /**
         * 模拟tooltip hover方法
         * {object} params  参数
         *          {seriesIndex: 0, seriesName:'', dataInex:0} line、bar、scatter、k、radar
         *          {seriesIndex: 0, seriesName:'', name:''} map、pie、chord
         */
        showTip: function (params) {
            if (!params) {
                return;
            }
            
            var seriesIndex;
            var series = this.option.series;
            if (params.seriesIndex != null) {
                seriesIndex = params.seriesIndex;
            }
            else {
                var seriesName = params.seriesName;
                for (var i = 0, l = series.length; i < l; i++) {
                    if (series[i].name === seriesName) {
                        seriesIndex = i;
                        break;
                    }
                }
            }
            
            var serie = series[seriesIndex];
            if (serie == null) {
                return;
            }
            var chart = this.myChart.chart[serie.type];
            var isAxisTrigger = this.deepQuery(
                                    [serie, this.option], 'tooltip.trigger'
                                ) === 'axis';
            
            if (!chart) {
                return;
            }
            
            if (isAxisTrigger) {
                // axis trigger
                var dataIndex = params.dataIndex;
                switch (chart.type) {
                    case ecConfig.CHART_TYPE_LINE :
                    case ecConfig.CHART_TYPE_BAR :
                    case ecConfig.CHART_TYPE_K :
                    case ecConfig.CHART_TYPE_RADAR :
                        if (this.component.polar == null 
                            || serie.data[0].value.length <= dataIndex
                        ) {
                            return;
                        }
                        var polarIndex = serie.polarIndex || 0;
                        var vector = this.component.polar.getVector(
                            polarIndex, dataIndex, 'max'
                        );
                        this._event = {
                            zrenderX: vector[0],
                            zrenderY: vector[1]
                        };
                        this._showPolarTrigger(
                            polarIndex, 
                            dataIndex
                        );
                        break;
                }
            }
            else {
                // item trigger
                var shapeList = chart.shapeList;
                var x;
                var y;
                switch (chart.type) {
                    case ecConfig.CHART_TYPE_LINE :
                    case ecConfig.CHART_TYPE_BAR :
                    case ecConfig.CHART_TYPE_K :
                    case ecConfig.CHART_TYPE_TREEMAP :
                    case ecConfig.CHART_TYPE_SCATTER :
                        var dataIndex = params.dataIndex;
                        for (var i = 0, l = shapeList.length; i < l; i++) {
                            if (shapeList[i]._mark == null
                                && ecData.get(shapeList[i], 'seriesIndex') == seriesIndex
                                && ecData.get(shapeList[i], 'dataIndex') == dataIndex
                            ) {
                                this._curTarget = shapeList[i];
                                x = shapeList[i].style.x;
                                y = chart.type != ecConfig.CHART_TYPE_K 
                                    ? shapeList[i].style.y : shapeList[i].style.y[0];
                                break;
                            }
                        }
                        break;
                    case ecConfig.CHART_TYPE_RADAR :
                        var dataIndex = params.dataIndex;
                        for (var i = 0, l = shapeList.length; i < l; i++) {
                            if (shapeList[i].type === 'polygon'
                                && ecData.get(shapeList[i], 'seriesIndex') == seriesIndex
                                && ecData.get(shapeList[i], 'dataIndex') == dataIndex
                            ) {
                                this._curTarget = shapeList[i];
                                var vector = this.component.polar.getCenter(
                                    serie.polarIndex || 0
                                );
                                x = vector[0];
                                y = vector[1];
                                break;
                            }
                        }
                        break;
                    case ecConfig.CHART_TYPE_PIE :
                        var name = params.name;
                        for (var i = 0, l = shapeList.length; i < l; i++) {
                            if (shapeList[i].type === 'sector'
                                && ecData.get(shapeList[i], 'seriesIndex') == seriesIndex
                                && ecData.get(shapeList[i], 'name') == name
                            ) {
                                this._curTarget = shapeList[i];
                                var style = this._curTarget.style;
                                var midAngle = (style.startAngle + style.endAngle) 
                                                / 2 * Math.PI / 180;
                                x = this._curTarget.style.x + Math.cos(midAngle) * style.r / 1.5;
                                y = this._curTarget.style.y - Math.sin(midAngle) * style.r / 1.5;
                                break;
                            }
                        }
                        break;
                    case ecConfig.CHART_TYPE_MAP :
                        var name = params.name;
                        var mapType = serie.mapType;
                        for (var i = 0, l = shapeList.length; i < l; i++) {
                            if (shapeList[i].type === 'text'
                                && shapeList[i]._mapType === mapType
                                && shapeList[i].style._name === name
                            ) {
                                this._curTarget = shapeList[i];
                                x = this._curTarget.style.x + this._curTarget.position[0];
                                y = this._curTarget.style.y + this._curTarget.position[1];
                                break;
                            }
                        }
                        break;
                    case ecConfig.CHART_TYPE_CHORD:
                        var name = params.name;
                        for (var i = 0, l = shapeList.length; i < l; i++) {
                            if (shapeList[i].type === 'sector'
                                && ecData.get(shapeList[i], 'name') == name
                            ) {
                                this._curTarget = shapeList[i];
                                var style = this._curTarget.style;
                                var midAngle = (style.startAngle + style.endAngle) 
                                                / 2 * Math.PI / 180;
                                x = this._curTarget.style.x + Math.cos(midAngle) * (style.r - 2);
                                y = this._curTarget.style.y - Math.sin(midAngle) * (style.r - 2);
                                this.zr.trigger(
                                    zrConfig.EVENT.MOUSEMOVE,
                                    {
                                        zrenderX: x,
                                        zrenderY: y
                                    }
                                );
                                return;
                            }
                        }
                        break;
                    case ecConfig.CHART_TYPE_FORCE:
                        var name = params.name;
                        for (var i = 0, l = shapeList.length; i < l; i++) {
                            if (shapeList[i].type === 'circle'
                                && ecData.get(shapeList[i], 'name') == name
                            ) {
                                this._curTarget = shapeList[i];
                                x = this._curTarget.position[0];
                                y = this._curTarget.position[1];
                                break;
                            }
                        }
                        break;
                }
                if (x != null && y != null) {
                    this._event = {
                        zrenderX: x,
                        zrenderY: y
                    };
                    this.zr.addHoverShape(this._curTarget);
                    this.zr.refreshHover();
                    this._showItemTrigger();
                }
            }
        },
        
        /**
         * 关闭，公开接口 
         */
        hideTip: function () {
            this._hide();
        },
        
        /**
         * 刷新
         */
        refresh: function (newOption) {
            // this._selectedMap;
            // this._defaultCssText;    // css样式缓存
            // this._needAxisTrigger;   // 坐标轴触发
            // this._curTarget;
            // this._event;
            // this._curTicket;         // 异步回调标识，用来区分多个请求
            
            // 缓存一些高宽数据
            this._zrHeight = this.zr.getHeight();
            this._zrWidth = this.zr.getWidth();
            
            if (this._lastTipShape && this._lastTipShape.tipShape.length > 0) {
                this.zr.delShape(this._lastTipShape.tipShape);
            }
            this._lastTipShape = false;
            this.shapeList.length = 2;
            
            this._lastDataIndex = -1;
            this._lastSeriesIndex = -1;
            this._lastItemTriggerId = -1;
            
            if (newOption) {
                this.option = newOption;
                this.option.tooltip = this.reformOption(this.option.tooltip);
                
                this.option.tooltip.textStyle = zrUtil.merge(
                    this.option.tooltip.textStyle,
                    this.ecTheme.textStyle
                );
                this._needAxisTrigger = false;
                if (this.option.tooltip.trigger === 'axis') {
                    this._needAxisTrigger = true;
                }
    
                var series = this.option.series;
                for (var i = 0, l = series.length; i < l; i++) {
                    if (this.query(series[i], 'tooltip.trigger') === 'axis') {
                        this._needAxisTrigger = true;
                        break;
                    }
                }
                // this._hidingTicket;
                // this._showingTicket;
                this._showDelay = this.option.tooltip.showDelay; // 显示延迟
                this._hideDelay = this.option.tooltip.hideDelay; // 隐藏延迟
                this._defaultCssText = this._style(this.option.tooltip);
                
                this._setSelectedMap();
                this._axisLineWidth = this.option.tooltip.axisPointer.lineStyle.width;
                this._enterable = this.option.tooltip.enterable;

                if (! this._enterable && this._tDom.className.indexOf(zrConfig.elementClassName) < 0) {
                    this._tDom.className += ' ' + zrConfig.elementClassName;
                }
            }
            if (this.showing) {
                var self = this;
                setTimeout(function(){
                    self.zr.trigger(zrConfig.EVENT.MOUSEMOVE, self.zr.handler._event);
                },50);
            }
        },

        /**
         * 释放后实例不可用，重载基类方法
         */
        onbeforDispose: function () {
            if (this._lastTipShape && this._lastTipShape.tipShape.length > 0) {
                this.zr.delShape(this._lastTipShape.tipShape);
            }
            clearTimeout(this._hidingTicket);
            clearTimeout(this._showingTicket);
            this.zr.un(zrConfig.EVENT.MOUSEMOVE, this._onmousemove);
            this.zr.un(zrConfig.EVENT.GLOBALOUT, this._onglobalout);
            
            if (this.hasAppend && !!this.dom.firstChild) {
                this.dom.firstChild.removeChild(this._tDom);
            }
            this._tDom = null;
        },
        
        /**
         * html转码的方法
         */
        _encodeHTML: function (source) {
            return String(source)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#39;');
        }
    };
    
    zrUtil.inherits(Tooltip, Base);
    
    require('../component').define('tooltip', Tooltip);

    return Tooltip;
});
define('zrender/tool/color', ['require', '../tool/util'], function (require) {
    var util = require('../tool/util');

    var _ctx;

    // Color palette is an array containing the default colors for the chart's
    // series.
    // When all colors are used, new colors are selected from the start again.
    // Defaults to:
    // 默认色板
    var palette = [
        '#ff9277', ' #dddd00', ' #ffc877', ' #bbe3ff', ' #d5ffbb',
        '#bbbbff', ' #ddb000', ' #b0dd00', ' #e2bbff', ' #ffbbe3',
        '#ff7777', ' #ff9900', ' #83dd00', ' #77e3ff', ' #778fff',
        '#c877ff', ' #ff77ab', ' #ff6600', ' #aa8800', ' #77c7ff',
        '#ad77ff', ' #ff77ff', ' #dd0083', ' #777700', ' #00aa00',
        '#0088aa', ' #8400dd', ' #aa0088', ' #dd0000', ' #772e00'
    ];
    var _palette = palette;

    var highlightColor = 'rgba(255,255,0,0.5)';
    var _highlightColor = highlightColor;

    // 颜色格式
    /*jshint maxlen: 330 */
    var colorRegExp = /^\s*((#[a-f\d]{6})|(#[a-f\d]{3})|rgba?\(\s*([\d\.]+%?\s*,\s*[\d\.]+%?\s*,\s*[\d\.]+%?(?:\s*,\s*[\d\.]+%?)?)\s*\)|hsba?\(\s*([\d\.]+(?:deg|\xb0|%)?\s*,\s*[\d\.]+%?\s*,\s*[\d\.]+%?(?:\s*,\s*[\d\.]+)?)%?\s*\)|hsla?\(\s*([\d\.]+(?:deg|\xb0|%)?\s*,\s*[\d\.]+%?\s*,\s*[\d\.]+%?(?:\s*,\s*[\d\.]+)?)%?\s*\))\s*$/i;

    var _nameColors = {
        aliceblue : '#f0f8ff',
        antiquewhite : '#faebd7',
        aqua : '#0ff',
        aquamarine : '#7fffd4',
        azure : '#f0ffff',
        beige : '#f5f5dc',
        bisque : '#ffe4c4',
        black : '#000',
        blanchedalmond : '#ffebcd',
        blue : '#00f',
        blueviolet : '#8a2be2',
        brown : '#a52a2a',
        burlywood : '#deb887',
        cadetblue : '#5f9ea0',
        chartreuse : '#7fff00',
        chocolate : '#d2691e',
        coral : '#ff7f50',
        cornflowerblue : '#6495ed',
        cornsilk : '#fff8dc',
        crimson : '#dc143c',
        cyan : '#0ff',
        darkblue : '#00008b',
        darkcyan : '#008b8b',
        darkgoldenrod : '#b8860b',
        darkgray : '#a9a9a9',
        darkgrey : '#a9a9a9',
        darkgreen : '#006400',
        darkkhaki : '#bdb76b',
        darkmagenta : '#8b008b',
        darkolivegreen : '#556b2f',
        darkorange : '#ff8c00',
        darkorchid : '#9932cc',
        darkred : '#8b0000',
        darksalmon : '#e9967a',
        darkseagreen : '#8fbc8f',
        darkslateblue : '#483d8b',
        darkslategray : '#2f4f4f',
        darkslategrey : '#2f4f4f',
        darkturquoise : '#00ced1',
        darkviolet : '#9400d3',
        deeppink : '#ff1493',
        deepskyblue : '#00bfff',
        dimgray : '#696969',
        dimgrey : '#696969',
        dodgerblue : '#1e90ff',
        firebrick : '#b22222',
        floralwhite : '#fffaf0',
        forestgreen : '#228b22',
        fuchsia : '#f0f',
        gainsboro : '#dcdcdc',
        ghostwhite : '#f8f8ff',
        gold : '#ffd700',
        goldenrod : '#daa520',
        gray : '#808080',
        grey : '#808080',
        green : '#008000',
        greenyellow : '#adff2f',
        honeydew : '#f0fff0',
        hotpink : '#ff69b4',
        indianred : '#cd5c5c',
        indigo : '#4b0082',
        ivory : '#fffff0',
        khaki : '#f0e68c',
        lavender : '#e6e6fa',
        lavenderblush : '#fff0f5',
        lawngreen : '#7cfc00',
        lemonchiffon : '#fffacd',
        lightblue : '#add8e6',
        lightcoral : '#f08080',
        lightcyan : '#e0ffff',
        lightgoldenrodyellow : '#fafad2',
        lightgray : '#d3d3d3',
        lightgrey : '#d3d3d3',
        lightgreen : '#90ee90',
        lightpink : '#ffb6c1',
        lightsalmon : '#ffa07a',
        lightseagreen : '#20b2aa',
        lightskyblue : '#87cefa',
        lightslategray : '#789',
        lightslategrey : '#789',
        lightsteelblue : '#b0c4de',
        lightyellow : '#ffffe0',
        lime : '#0f0',
        limegreen : '#32cd32',
        linen : '#faf0e6',
        magenta : '#f0f',
        maroon : '#800000',
        mediumaquamarine : '#66cdaa',
        mediumblue : '#0000cd',
        mediumorchid : '#ba55d3',
        mediumpurple : '#9370d8',
        mediumseagreen : '#3cb371',
        mediumslateblue : '#7b68ee',
        mediumspringgreen : '#00fa9a',
        mediumturquoise : '#48d1cc',
        mediumvioletred : '#c71585',
        midnightblue : '#191970',
        mintcream : '#f5fffa',
        mistyrose : '#ffe4e1',
        moccasin : '#ffe4b5',
        navajowhite : '#ffdead',
        navy : '#000080',
        oldlace : '#fdf5e6',
        olive : '#808000',
        olivedrab : '#6b8e23',
        orange : '#ffa500',
        orangered : '#ff4500',
        orchid : '#da70d6',
        palegoldenrod : '#eee8aa',
        palegreen : '#98fb98',
        paleturquoise : '#afeeee',
        palevioletred : '#d87093',
        papayawhip : '#ffefd5',
        peachpuff : '#ffdab9',
        peru : '#cd853f',
        pink : '#ffc0cb',
        plum : '#dda0dd',
        powderblue : '#b0e0e6',
        purple : '#800080',
        red : '#f00',
        rosybrown : '#bc8f8f',
        royalblue : '#4169e1',
        saddlebrown : '#8b4513',
        salmon : '#fa8072',
        sandybrown : '#f4a460',
        seagreen : '#2e8b57',
        seashell : '#fff5ee',
        sienna : '#a0522d',
        silver : '#c0c0c0',
        skyblue : '#87ceeb',
        slateblue : '#6a5acd',
        slategray : '#708090',
        slategrey : '#708090',
        snow : '#fffafa',
        springgreen : '#00ff7f',
        steelblue : '#4682b4',
        tan : '#d2b48c',
        teal : '#008080',
        thistle : '#d8bfd8',
        tomato : '#ff6347',
        turquoise : '#40e0d0',
        violet : '#ee82ee',
        wheat : '#f5deb3',
        white : '#fff',
        whitesmoke : '#f5f5f5',
        yellow : '#ff0',
        yellowgreen : '#9acd32'
    };

    /**
     * 自定义调色板
     */
    function customPalette(userPalete) {
        palette = userPalete;
    }

    /**
     * 复位默认色板
     */
    function resetPalette() {
        palette = _palette;
    }

    /**
     * 获取色板颜色
     * @memberOf module:zrender/tool/color
     * @param {number} idx 色板位置
     * @param {Array.<string>} [userPalete] 自定义色板
     * @return {string} 颜色
     */
    function getColor(idx, userPalete) {
        idx = idx | 0;
        userPalete = userPalete || palette;
        return userPalete[idx % userPalete.length];
    }

    /**
     * 自定义默认高亮颜色
     */
    function customHighlight(userHighlightColor) {
        highlightColor = userHighlightColor;
    }

    /**
     * 重置默认高亮颜色
     */
    function resetHighlight() {
        _highlightColor = highlightColor;
    }

    /**
     * 获取默认高亮颜色
     */
    function getHighlightColor() {
        return highlightColor;
    }

    /**
     * 径向渐变
     * @memberOf module:zrender/tool/color
     * @param {number} x0 渐变起点
     * @param {number} y0
     * @param {number} r0
     * @param {number} x1 渐变终点
     * @param {number} y1
     * @param {number} r1
     * @param {Array} colorList 颜色列表
     * @return {CanvasGradient}
     */
    function getRadialGradient(x0, y0, r0, x1, y1, r1, colorList) {
        if (!_ctx) {
            _ctx = util.getContext();
        }
        var gradient = _ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
        for (var i = 0, l = colorList.length; i < l; i++) {
            gradient.addColorStop(colorList[i][0], colorList[i][1]);
        }
        gradient.__nonRecursion = true;
        return gradient;
    }

    /**
     * 线性渐变
     * @param {Object} x0 渐变起点
     * @param {Object} y0
     * @param {Object} x1 渐变终点
     * @param {Object} y1
     * @param {Array} colorList 颜色列表
     */
    function getLinearGradient(x0, y0, x1, y1, colorList) {
        if (!_ctx) {
            _ctx = util.getContext();
        }
        var gradient = _ctx.createLinearGradient(x0, y0, x1, y1);
        for (var i = 0, l = colorList.length; i < l; i++) {
            gradient.addColorStop(colorList[i][0], colorList[i][1]);
        }
        gradient.__nonRecursion = true;
        return gradient;
    }

    /**
     * 获取两种颜色之间渐变颜色数组
     * @param {color} start 起始颜色
     * @param {color} end 结束颜色
     * @param {number} step 渐变级数
     * @return {Array}  颜色数组
     */
    function getStepColors(start, end, step) {
        start = toRGBA(start);
        end = toRGBA(end);
        start = getData(start);
        end = getData(end);

        var colors = [];
        var stepR = (end[0] - start[0]) / step;
        var stepG = (end[1] - start[1]) / step;
        var stepB = (end[2] - start[2]) / step;
        var stepA = (end[3] - start[3]) / step;
        // 生成颜色集合
        // fix by linfeng 颜色堆积
        for (var i = 0, r = start[0], g = start[1], b = start[2], a = start[3]; i < step; i++) {
            colors[i] = toColor([
                adjust(Math.floor(r), [ 0, 255 ]),
                adjust(Math.floor(g), [ 0, 255 ]), 
                adjust(Math.floor(b), [ 0, 255 ]),
                a.toFixed(4) - 0
            ],'rgba');
            r += stepR;
            g += stepG;
            b += stepB;
            a += stepA;
        }
        r = end[0];
        g = end[1];
        b = end[2];
        a = end[3];
        colors[i] = toColor([r, g, b, a], 'rgba');
        return colors;
    }

    /**
     * 获取指定级数的渐变颜色数组
     * @memberOf module:zrender/tool/color
     * @param {Array.<string>} colors 颜色组
     * @param {number} [step=20] 渐变级数
     * @return {Array.<string>}  颜色数组
     */
    function getGradientColors(colors, step) {
        var ret = [];
        var len = colors.length;
        if (step === undefined) {
            step = 20;
        }
        if (len === 1) {
            ret = getStepColors(colors[0], colors[0], step);
        }
        else if (len > 1) {
            for (var i = 0, n = len - 1; i < n; i++) {
                var steps = getStepColors(colors[i], colors[i + 1], step);
                if (i < n - 1) {
                    steps.pop();
                }
                ret = ret.concat(steps);
            }
        }
        return ret;
    }

    /**
     * 颜色值数组转为指定格式颜色,例如:<br/>
     * data = [60,20,20,0.1] format = 'rgba'
     * 返回：rgba(60,20,20,0.1)
     * @param {Array} data 颜色值数组
     * @param {string} format 格式,默认rgb
     * @return {string} 颜色
     */
    function toColor(data, format) {
        format = format || 'rgb';
        if (data && (data.length === 3 || data.length === 4)) {
            data = map(data,
                function(c) {
                    return c > 1 ? Math.ceil(c) : c;
                }
            );

            if (format.indexOf('hex') > -1) {
                return '#' + ((1 << 24) + (data[0] << 16) + (data[1] << 8) + (+data[2])).toString(16).slice(1);
            }
            else if (format.indexOf('hs') > -1) {
                var sx = map(data.slice(1, 3),
                    function(c) {
                        return c + '%';
                    }
                );
                data[1] = sx[0];
                data[2] = sx[1];
            }

            if (format.indexOf('a') > -1) {
                if (data.length === 3) {
                    data.push(1);
                }
                data[3] = adjust(data[3], [ 0, 1 ]);
                return format + '(' + data.slice(0, 4).join(',') + ')';
            }

            return format + '(' + data.slice(0, 3).join(',') + ')';
        }
    }

    /**
     * 颜色字符串转换为rgba数组
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {Array.<number>} 颜色值数组
     */
    function toArray(color) {
        color = trim(color);
        if (color.indexOf('rgba') < 0) {
            color = toRGBA(color);
        }

        var data = [];
        var i = 0;
        color.replace(/[\d.]+/g, function (n) {
            if (i < 3) {
                n = n | 0;
            }
            else {
                // Alpha
                n = +n;
            }
            data[i++] = n;
        });
        return data;
    }

    /**
     * 颜色格式转化
     *
     * @param {string} color 颜色值数组
     * @param {string} format 格式,默认rgb
     * @return {string} 颜色
     */
    function convert(color, format) {
        if (!isCalculableColor(color)) {
            return color;
        }
        var data = getData(color);
        var alpha = data[3];
        if (typeof alpha === 'undefined') {
            alpha = 1;
        }

        if (color.indexOf('hsb') > -1) {
            data = _HSV_2_RGB(data);
        }
        else if (color.indexOf('hsl') > -1) {
            data = _HSL_2_RGB(data);
        }

        if (format.indexOf('hsb') > -1 || format.indexOf('hsv') > -1) {
            data = _RGB_2_HSB(data);
        }
        else if (format.indexOf('hsl') > -1) {
            data = _RGB_2_HSL(data);
        }

        data[3] = alpha;

        return toColor(data, format);
    }

    /**
     * 转换为rgba格式的颜色
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {string} rgba颜色，rgba(r,g,b,a)
     */
    function toRGBA(color) {
        return convert(color, 'rgba');
    }

    /**
     * 转换为rgb数字格式的颜色
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {string} rgb颜色，rgb(0,0,0)格式
     */
    function toRGB(color) {
        return convert(color, 'rgb');
    }

    /**
     * 转换为16进制颜色
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {string} 16进制颜色，#rrggbb格式
     */
    function toHex(color) {
        return convert(color, 'hex');
    }

    /**
     * 转换为HSV颜色
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {string} HSVA颜色，hsva(h,s,v,a)
     */
    function toHSVA(color) {
        return convert(color, 'hsva');
    }

    /**
     * 转换为HSV颜色
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {string} HSV颜色，hsv(h,s,v)
     */
    function toHSV(color) {
        return convert(color, 'hsv');
    }

    /**
     * 转换为HSBA颜色
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {string} HSBA颜色，hsba(h,s,b,a)
     */
    function toHSBA(color) {
        return convert(color, 'hsba');
    }

    /**
     * 转换为HSB颜色
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {string} HSB颜色，hsb(h,s,b)
     */
    function toHSB(color) {
        return convert(color, 'hsb');
    }

    /**
     * 转换为HSLA颜色
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {string} HSLA颜色，hsla(h,s,l,a)
     */
    function toHSLA(color) {
        return convert(color, 'hsla');
    }

    /**
     * 转换为HSL颜色
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {string} HSL颜色，hsl(h,s,l)
     */
    function toHSL(color) {
        return convert(color, 'hsl');
    }

    /**
     * 转换颜色名
     * 
     * @param {string} color 颜色
     * @return {string} 颜色名
     */
    function toName(color) {
        for (var key in _nameColors) {
            if (toHex(_nameColors[key]) === toHex(color)) {
                return key;
            }
        }
        return null;
    }

    /**
     * 移除颜色中多余空格
     * 
     * @param {string} color 颜色
     * @return {string} 无空格颜色
     */
    function trim(color) {
        return String(color).replace(/\s+/g, '');
    }

    /**
     * 颜色规范化
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {string} 规范化后的颜色
     */
    function normalize(color) {
        // 颜色名
        if (_nameColors[color]) {
            color = _nameColors[color];
        }
        // 去掉空格
        color = trim(color);
        // hsv与hsb等价
        color = color.replace(/hsv/i, 'hsb');
        // rgb转为rrggbb
        if (/^#[\da-f]{3}$/i.test(color)) {
            color = parseInt(color.slice(1), 16);
            var r = (color & 0xf00) << 8;
            var g = (color & 0xf0) << 4;
            var b = color & 0xf;

            color = '#' + ((1 << 24) + (r << 4) + r + (g << 4) + g + (b << 4) + b).toString(16).slice(1);
        }
        // 或者使用以下正则替换，不过 chrome 下性能相对差点
        // color = color.replace(/^#([\da-f])([\da-f])([\da-f])$/i, '#$1$1$2$2$3$3');
        return color;
    }

    /**
     * 颜色加深或减淡，当level>0加深，当level<0减淡
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @param {number} level 升降程度,取值区间[-1,1]
     * @return {string} 加深或减淡后颜色值
     */
    function lift(color, level) {
        if (!isCalculableColor(color)) {
            return color;
        }
        var direct = level > 0 ? 1 : -1;
        if (typeof level === 'undefined') {
            level = 0;
        }
        level = Math.abs(level) > 1 ? 1 : Math.abs(level);
        color = toRGB(color);
        var data = getData(color);
        for (var i = 0; i < 3; i++) {
            if (direct === 1) {
                data[i] = data[i] * (1 - level) | 0;
            }
            else {
                data[i] = ((255 - data[i]) * level + data[i]) | 0;
            }
        }
        return 'rgb(' + data.join(',') + ')';
    }

    /**
     * 颜色翻转,[255-r,255-g,255-b,1-a]
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @return {string} 翻转颜色
     */
    function reverse(color) {
        if (!isCalculableColor(color)) {
            return color;
        }
        var data = getData(toRGBA(color));
        data = map(data,
            function(c) {
                return 255 - c;
            }
        );
        return toColor(data, 'rgb');
    }

    /**
     * 简单两种颜色混合
     * @memberOf module:zrender/tool/color
     * @param {string} color1 第一种颜色
     * @param {string} color2 第二种颜色
     * @param {number} weight 混合权重[0-1]
     * @return {string} 结果色,rgb(r,g,b)或rgba(r,g,b,a)
     */
    function mix(color1, color2, weight) {
        if (!isCalculableColor(color1) || !isCalculableColor(color2)) {
            return color1;
        }
        
        if (typeof weight === 'undefined') {
            weight = 0.5;
        }
        weight = 1 - adjust(weight, [ 0, 1 ]);

        var w = weight * 2 - 1;
        var data1 = getData(toRGBA(color1));
        var data2 = getData(toRGBA(color2));

        var d = data1[3] - data2[3];

        var weight1 = (((w * d === -1) ? w : (w + d) / (1 + w * d)) + 1) / 2;
        var weight2 = 1 - weight1;

        var data = [];

        for (var i = 0; i < 3; i++) {
            data[i] = data1[i] * weight1 + data2[i] * weight2;
        }

        var alpha = data1[3] * weight + data2[3] * (1 - weight);
        alpha = Math.max(0, Math.min(1, alpha));

        if (data1[3] === 1 && data2[3] === 1) {// 不考虑透明度
            return toColor(data, 'rgb');
        }
        data[3] = alpha;
        return toColor(data, 'rgba');
    }

    /**
     * 随机颜色
     * 
     * @return {string} 颜色值，#rrggbb格式
     */
    function random() {
        return '#' + (Math.random().toString(16) + '0000').slice(2, 8);
    }

    /**
     * 获取颜色值数组,返回值范围： <br/>
     * RGB 范围[0-255] <br/>
     * HSL/HSV/HSB 范围[0-1]<br/>
     * A透明度范围[0-1]
     * 支持格式：
     * #rgb
     * #rrggbb
     * rgb(r,g,b)
     * rgb(r%,g%,b%)
     * rgba(r,g,b,a)
     * hsb(h,s,b) // hsv与hsb等价
     * hsb(h%,s%,b%)
     * hsba(h,s,b,a)
     * hsl(h,s,l)
     * hsl(h%,s%,l%)
     * hsla(h,s,l,a)
     *
     * @param {string} color 颜色
     * @return {Array.<number>} 颜色值数组或null
     */
    function getData(color) {
        color = normalize(color);
        var r = color.match(colorRegExp);
        if (r === null) {
            throw new Error('The color format error'); // 颜色格式错误
        }
        var d;
        var a;
        var data = [];
        var rgb;

        if (r[2]) {
            // #rrggbb
            d = r[2].replace('#', '').split('');
            rgb = [ d[0] + d[1], d[2] + d[3], d[4] + d[5] ];
            data = map(rgb,
                function(c) {
                    return adjust(parseInt(c, 16), [ 0, 255 ]);
                }
            );

        }
        else if (r[4]) {
            // rgb rgba
            var rgba = (r[4]).split(',');
            a = rgba[3];
            rgb = rgba.slice(0, 3);
            data = map(
                rgb,
                function(c) {
                    c = Math.floor(
                        c.indexOf('%') > 0 ? parseInt(c, 0) * 2.55 : c
                    );
                    return adjust(c, [ 0, 255 ]);
                }
            );

            if (typeof a !== 'undefined') {
                data.push(adjust(parseFloat(a), [ 0, 1 ]));
            }
        }
        else if (r[5] || r[6]) {
            // hsb hsba hsl hsla
            var hsxa = (r[5] || r[6]).split(',');
            var h = parseInt(hsxa[0], 0) / 360;
            var s = hsxa[1];
            var x = hsxa[2];
            a = hsxa[3];
            data = map([ s, x ],
                function(c) {
                    return adjust(parseFloat(c) / 100, [ 0, 1 ]);
                }
            );
            data.unshift(h);
            if (typeof a !== 'undefined') {
                data.push(adjust(parseFloat(a), [ 0, 1 ]));
            }
        }
        return data;
    }

    /**
     * 设置颜色透明度
     * @memberOf module:zrender/tool/color
     * @param {string} color 颜色
     * @param {number} a 透明度,区间[0,1]
     * @return {string} rgba颜色值
     */
    function alpha(color, a) {
        if (!isCalculableColor(color)) {
            return color;
        }
        if (a === null) {
            a = 1;
        }
        var data = getData(toRGBA(color));
        data[3] = adjust(Number(a).toFixed(4), [ 0, 1 ]);

        return toColor(data, 'rgba');
    }

    // 数组映射
    function map(array, fun) {
        if (typeof fun !== 'function') {
            throw new TypeError();
        }
        var len = array ? array.length : 0;
        for (var i = 0; i < len; i++) {
            array[i] = fun(array[i]);
        }
        return array;
    }

    // 调整值区间
    function adjust(value, region) {
        // < to <= & > to >=
        // modify by linzhifeng 2014-05-25 because -0 == 0
        if (value <= region[0]) {
            value = region[0];
        }
        else if (value >= region[1]) {
            value = region[1];
        }
        return value;
    }
    
    function isCalculableColor(color) {
        return color instanceof Array || typeof color === 'string';
    }

    // 参见 http:// www.easyrgb.com/index.php?X=MATH
    function _HSV_2_RGB(data) {
        var H = data[0];
        var S = data[1];
        var V = data[2];
        // HSV from 0 to 1
        var R; 
        var G;
        var B;
        if (S === 0) {
            R = V * 255;
            G = V * 255;
            B = V * 255;
        }
        else {
            var h = H * 6;
            if (h === 6) {
                h = 0;
            }
            var i = h | 0;
            var v1 = V * (1 - S);
            var v2 = V * (1 - S * (h - i));
            var v3 = V * (1 - S * (1 - (h - i)));
            var r = 0;
            var g = 0;
            var b = 0;

            if (i === 0) {
                r = V;
                g = v3;
                b = v1;
            }
            else if (i === 1) {
                r = v2;
                g = V;
                b = v1;
            }
            else if (i === 2) {
                r = v1;
                g = V;
                b = v3;
            }
            else if (i === 3) {
                r = v1;
                g = v2;
                b = V;
            }
            else if (i === 4) {
                r = v3;
                g = v1;
                b = V;
            }
            else {
                r = V;
                g = v1;
                b = v2;
            }

            // RGB results from 0 to 255
            R = r * 255;
            G = g * 255;
            B = b * 255;
        }
        return [ R, G, B ];
    }

    function _HSL_2_RGB(data) {
        var H = data[0];
        var S = data[1];
        var L = data[2];
        // HSL from 0 to 1
        var R;
        var G;
        var B;
        if (S === 0) {
            R = L * 255;
            G = L * 255;
            B = L * 255;
        }
        else {
            var v2;
            if (L < 0.5) {
                v2 = L * (1 + S);
            }
            else {
                v2 = (L + S) - (S * L);
            }

            var v1 = 2 * L - v2;

            R = 255 * _HUE_2_RGB(v1, v2, H + (1 / 3));
            G = 255 * _HUE_2_RGB(v1, v2, H);
            B = 255 * _HUE_2_RGB(v1, v2, H - (1 / 3));
        }
        return [ R, G, B ];
    }

    function _HUE_2_RGB(v1, v2, vH) {
        if (vH < 0) {
            vH += 1;
        }
        if (vH > 1) {
            vH -= 1;
        }
        if ((6 * vH) < 1) {
            return (v1 + (v2 - v1) * 6 * vH);
        }
        if ((2 * vH) < 1) {
            return (v2);
        }
        if ((3 * vH) < 2) {
            return (v1 + (v2 - v1) * ((2 / 3) - vH) * 6);
        }
        return v1;
    }

    function _RGB_2_HSB(data) {
        // RGB from 0 to 255
        var R = (data[0] / 255);
        var G = (data[1] / 255);
        var B = (data[2] / 255);

        var vMin = Math.min(R, G, B); // Min. value of RGB
        var vMax = Math.max(R, G, B); // Max. value of RGB
        var delta = vMax - vMin; // Delta RGB value
        var V = vMax;
        var H;
        var S;

        // HSV results from 0 to 1
        if (delta === 0) {
            H = 0;
            S = 0;
        }
        else {
            S = delta / vMax;

            var deltaR = (((vMax - R) / 6) + (delta / 2)) / delta;
            var deltaG = (((vMax - G) / 6) + (delta / 2)) / delta;
            var deltaB = (((vMax - B) / 6) + (delta / 2)) / delta;

            if (R === vMax) {
                H = deltaB - deltaG;
            }
            else if (G === vMax) {
                H = (1 / 3) + deltaR - deltaB;
            }
            else if (B === vMax) {
                H = (2 / 3) + deltaG - deltaR;
            }

            if (H < 0) {
                H += 1;
            }
            if (H > 1) {
                H -= 1;
            }
        }
        H = H * 360;
        S = S * 100;
        V = V * 100;
        return [ H, S, V ];
    }

    function _RGB_2_HSL(data) {
        // RGB from 0 to 255
        var R = (data[0] / 255);
        var G = (data[1] / 255);
        var B = (data[2] / 255);

        var vMin = Math.min(R, G, B); // Min. value of RGB
        var vMax = Math.max(R, G, B); // Max. value of RGB
        var delta = vMax - vMin; // Delta RGB value

        var L = (vMax + vMin) / 2;
        var H;
        var S;
        // HSL results from 0 to 1
        if (delta === 0) {
            H = 0;
            S = 0;
        }
        else {
            if (L < 0.5) {
                S = delta / (vMax + vMin);
            }
            else {
                S = delta / (2 - vMax - vMin);
            }

            var deltaR = (((vMax - R) / 6) + (delta / 2)) / delta;
            var deltaG = (((vMax - G) / 6) + (delta / 2)) / delta;
            var deltaB = (((vMax - B) / 6) + (delta / 2)) / delta;

            if (R === vMax) {
                H = deltaB - deltaG;
            }
            else if (G === vMax) {
                H = (1 / 3) + deltaR - deltaB;
            }
            else if (B === vMax) {
                H = (2 / 3) + deltaG - deltaR;
            }

            if (H < 0) {
                H += 1;
            }

            if (H > 1) {
                H -= 1;
            }
        }

        H = H * 360;
        S = S * 100;
        L = L * 100;

        return [ H, S, L ];
    }

    return {
        customPalette : customPalette,
        resetPalette : resetPalette,
        getColor : getColor,
        getHighlightColor : getHighlightColor,
        customHighlight : customHighlight,
        resetHighlight : resetHighlight,
        getRadialGradient : getRadialGradient,
        getLinearGradient : getLinearGradient,
        getGradientColors : getGradientColors,
        getStepColors : getStepColors,
        reverse : reverse,
        mix : mix,
        lift : lift,
        trim : trim,
        random : random,
        toRGB : toRGB,
        toRGBA : toRGBA,
        toHex : toHex,
        toHSL : toHSL,
        toHSLA : toHSLA,
        toHSB : toHSB,
        toHSBA : toHSBA,
        toHSV : toHSV,
        toHSVA : toHSVA,
        toName : toName,
        toColor : toColor,
        toArray : toArray,
        alpha : alpha,
        getData : getData
    };
});
define('echarts/chart', [], function (/*require*/) {     //chart
    var self = {};

    var _chartLibrary = {};         //echart图表库

    /**
     * 定义图形实现
     * @param {Object} name
     * @param {Object} clazz 图形实现
     */
    self.define = function (name, clazz) {
        _chartLibrary[name] = clazz;
        return self;
    };

    /**
     * 获取图形实现
     * @param {Object} name
     */
    self.get = function (name) {
        return _chartLibrary[name];
    };

    return self;
});
define('echarts/util/ecData', [], function () {
    /**
     * 打包私有数据
     *
     * @param {shape} shape 修改目标
     * @param {Object} series
     * @param {number} seriesIndex
     * @param {number | Object} data
     * @param {number} dataIndex
     * @param {*=} special
     * @param {*=} special2
     */
    function pack(
        shape, series, seriesIndex, data, dataIndex, name, special, special2
    ) {
        var value;
        if (typeof data != 'undefined') {
            value = data.value == null
                ? data
                : data.value;
        }

        shape._echartsData = {
            '_series' : series,
            '_seriesIndex' : seriesIndex,
            '_data' : data,
            '_dataIndex' : dataIndex,
            '_name' : name,
            '_value' : value,
            '_special' : special,
            '_special2' : special2
        };
        return shape._echartsData;
    }

    /**
     * 从私有数据中获取特定项
     * @param {shape} shape
     * @param {string} key
     */
    function get(shape, key) {
        var data = shape._echartsData;
        if (!key) {
            return data;
        }

        switch (key) {
            case 'series' :
            case 'seriesIndex' :
            case 'data' :
            case 'dataIndex' :
            case 'name' :
            case 'value' :
            case 'special' :
            case 'special2' :
                return data && data['_' + key];
        }

        return null;
    }

    /**
     * 修改私有数据中获取特定项
     * @param {shape} shape
     * @param {string} key
     * @param {*} value
     */
    function set(shape, key, value) {
        shape._echartsData = shape._echartsData || {};
        switch (key) {
            case 'series' :             // 当前系列值
            case 'seriesIndex' :        // 系列数组位置索引
            case 'data' :               // 当前数据值
            case 'dataIndex' :          // 数据数组位置索引
            case 'name' :
            case 'value' :
            case 'special' :
            case 'special2' :
                shape._echartsData['_' + key] = value;
                break;
        }
    }
    
    /**
     * 私有数据克隆，把source拷贝到target上
     * @param {shape} source 源
     * @param {shape} target 目标
     */
    function clone(source, target) {
        target._echartsData =  {
            '_series' : source._echartsData._series,
            '_seriesIndex' : source._echartsData._seriesIndex,
            '_data' : source._echartsData._data,
            '_dataIndex' : source._echartsData._dataIndex,
            '_name' : source._echartsData._name,
            '_value' : source._echartsData._value,
            '_special' : source._echartsData._special,
            '_special2' : source._echartsData._special2
        };
    }

    return {
        pack : pack,
        set : set,
        get : get,
        clone : clone
    };
});
define('echarts/component/timeline', ['require', './base', 'zrender/shape/Rectangle', '../util/shape/Icon', '../util/shape/Chain', '../config', 'zrender/tool/util', 'zrender/tool/area', 'zrender/tool/event', '../component'], function (require) {
    var Base = require('./base');
    
    // 图形依赖
    var RectangleShape = require('zrender/shape/Rectangle');
    var IconShape = require('../util/shape/Icon');
    var ChainShape = require('../util/shape/Chain');
    
    var ecConfig = require('../config');
    ecConfig.timeline = {
        zlevel: 0,                  // 一级层叠
        z: 4,                       // 二级层叠
        show: true,
        type: 'time',  // 模式是时间类型，支持 number
        notMerge: false,
        realtime: true,
        x: 80,
        // y: {number},
        x2: 80,
        y2: 0,
        // width: {totalWidth} - x - x2,
        height: 50,
        backgroundColor: 'rgba(0,0,0,0)',   // 时间轴背景颜色
        borderColor: '#ccc',               // 时间轴边框颜色
        borderWidth: 0,                    // 时间轴边框线宽，单位px，默认为0（无边框）
        padding: 5,                        // 时间轴内边距，单位px，默认各方向内边距为5，
        controlPosition: 'left',           // 'right' | 'none'
        autoPlay: false,
        loop: true,
        playInterval: 2000,                // 播放时间间隔，单位ms
        lineStyle: {
            width: 1,
            color: '#666',
            type: 'dashed'
        },
        label: {                            // 文本标签
            show: true,
            interval: 'auto',
            rotate: 0,
            // formatter: null,
            textStyle: {                    // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                color: '#333'
            }
        },
        checkpointStyle: {
            symbol: 'auto',
            symbolSize: 'auto',
            color: 'auto',
            borderColor: 'auto',
            borderWidth: 'auto',
            label: {                            // 文本标签
                show: false,
                textStyle: {                    // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                    color: 'auto'
                }
            }
        },
        controlStyle: {
            itemSize: 15,
            itemGap: 5,
            normal: { color: '#333'},
            emphasis: { color: '#1e90ff'}
        },
        symbol: 'emptyDiamond',
        symbolSize: 4,
        currentIndex: 0
        // data: []
    };

    var zrUtil = require('zrender/tool/util');
    var zrArea = require('zrender/tool/area');
    var zrEvent = require('zrender/tool/event');

    /**
     * 构造函数
     * @param {Object} messageCenter echart消息中心
     * @param {ZRender} zr zrender实例
     * @param {Object} option 图表参数
     */
    function Timeline(ecTheme, messageCenter, zr, option, myChart) {
        Base.call(this, ecTheme, messageCenter, zr, option, myChart);

        var self = this;
        self._onclick = function(param) {
            return self.__onclick(param);
        };
        self._ondrift = function (dx, dy) {
            return self.__ondrift(this, dx, dy);
        };
        self._ondragend = function () {
            return self.__ondragend();
        };
        self._setCurrentOption = function() {
            var timelineOption = self.timelineOption;
            self.currentIndex %= timelineOption.data.length;
            // console.log(self.currentIndex);
            var curOption = self.options[self.currentIndex] || {};
            self.myChart._setOption(curOption, timelineOption.notMerge, true);
            
            self.messageCenter.dispatch(
                ecConfig.EVENT.TIMELINE_CHANGED,
                null,
                {
                    currentIndex: self.currentIndex,
                    data: timelineOption.data[self.currentIndex].name != null
                          ? timelineOption.data[self.currentIndex].name
                          : timelineOption.data[self.currentIndex]
                },
                self.myChart
            );
        };
        self._onFrame = function() {
            self._setCurrentOption();
            self._syncHandleShape();
            
            if (self.timelineOption.autoPlay) {
                self.playTicket = setTimeout(
                    function() {
                        self.currentIndex += 1;
                        if (!self.timelineOption.loop
                            && self.currentIndex >= self.timelineOption.data.length
                        ) {
                            self.currentIndex = self.timelineOption.data.length - 1;
                            self.stop();
                            return;
                        }
                        self._onFrame();
                    },
                    self.timelineOption.playInterval
                );
            }
        };

        this.setTheme(false);
        this.options = this.option.options;
        this.currentIndex = this.timelineOption.currentIndex % this.timelineOption.data.length;
        
        if (!this.timelineOption.notMerge && this.currentIndex !== 0) {
            /*
            for (var i = 1, l = this.timelineOption.data.length; i < l; i++) {
                this.options[i] = zrUtil.merge(
                    this.options[i], this.options[i - 1]
                );
            }
            */
           this.options[this.currentIndex] = zrUtil.merge(
               this.options[this.currentIndex], this.options[0]
           );
        }
        
        if (this.timelineOption.show) {
            this._buildShape();
            this._syncHandleShape();
        }
        
        this._setCurrentOption();
        
        if (this.timelineOption.autoPlay) {
            var self = this;
            this.playTicket = setTimeout(
                function() {
                    self.play();
                },
                this.ecTheme.animationDuration != null
                ? this.ecTheme.animationDuration
                : ecConfig.animationDuration
            );
        }
    }
    
    Timeline.prototype = {
        type: ecConfig.COMPONENT_TYPE_TIMELINE,
        _buildShape: function () {
            // 位置参数，通过计算所得x, y, width, height
            this._location = this._getLocation();
            this._buildBackground();
            this._buildControl();
            this._chainPoint = this._getChainPoint();
            if (this.timelineOption.label.show) {
                // 标签显示的挑选间隔
                var interval = this._getInterval();
                for (var i = 0, len = this._chainPoint.length; i < len; i += interval) {
                    this._chainPoint[i].showLabel = true;
                }
            }
            this._buildChain();
            this._buildHandle();

            for (var i = 0, l = this.shapeList.length; i < l; i++) {
                this.zr.addShape(this.shapeList[i]);
            }
        },

        /**
         * 根据选项计算实体的位置坐标
         */
        _getLocation: function () {
            var timelineOption = this.timelineOption;
            var padding = this.reformCssArray(this.timelineOption.padding);
            
            // 水平布局
            var zrWidth = this.zr.getWidth();
            var x = this.parsePercent(timelineOption.x, zrWidth);
            var x2 = this.parsePercent(timelineOption.x2, zrWidth);
            var width;
            if (timelineOption.width == null) {
                width = zrWidth - x - x2;
                x2 = zrWidth - x2;
            }
            else {
                width = this.parsePercent(timelineOption.width, zrWidth);
                x2 = x + width;
            }

            var zrHeight = this.zr.getHeight();
            var height = this.parsePercent(timelineOption.height, zrHeight);
            var y;
            var y2;
            if (timelineOption.y != null) {
                y = this.parsePercent(timelineOption.y, zrHeight);
                y2 = y + height;
            }
            else {
                y2 = zrHeight - this.parsePercent(timelineOption.y2, zrHeight);
                y = y2 - height;
            }

            return {
                x: x + padding[3],
                y: y + padding[0],
                x2: x2 - padding[1],
                y2: y2 - padding[2],
                width: width - padding[1] - padding[3],
                height: height - padding[0] - padding[2]
            };
        },

        _getReformedLabel: function (idx) {
            var timelineOption = this.timelineOption;
            var data = timelineOption.data[idx].name != null
                       ? timelineOption.data[idx].name
                       : timelineOption.data[idx];
            var formatter = timelineOption.data[idx].formatter 
                            || timelineOption.label.formatter;
            if (formatter) {
                if (typeof formatter === 'function') {
                    data = formatter.call(this.myChart, data);
                }
                else if (typeof formatter === 'string') {
                    data = formatter.replace('{value}', data);
                }
            }
            return data;
        },
        
        /**
         * 计算标签显示挑选间隔
         */
        _getInterval: function () {
            var chainPoint = this._chainPoint;
            var timelineOption = this.timelineOption;
            var interval   = timelineOption.label.interval;
            if (interval === 'auto') {
                // 麻烦的自适应计算
                var fontSize = timelineOption.label.textStyle.fontSize;
                var data = timelineOption.data;
                var dataLength = timelineOption.data.length;

                // 横向
                if (dataLength > 3) {
                    var isEnough = false;
                    var labelSpace;
                    var labelSize;
                    interval = 0;
                    while (!isEnough && interval < dataLength) {
                        interval++;
                        isEnough = true;
                        for (var i = interval; i < dataLength; i += interval) {
                            labelSpace = chainPoint[i].x - chainPoint[i - interval].x;
                            if (timelineOption.label.rotate !== 0) {
                                // 有旋转
                                labelSize = fontSize;
                            }
                            else if (data[i].textStyle) {
                                labelSize = zrArea.getTextWidth(
                                    chainPoint[i].name,
                                    chainPoint[i].textFont
                                );
                            }
                            else {
                                // 不定义data级特殊文本样式，用fontSize优化getTextWidth
                                var label = chainPoint[i].name + '';
                                var wLen = (label.match(/\w/g) || '').length;
                                var oLen = label.length - wLen;
                                labelSize = wLen * fontSize * 2 / 3 + oLen * fontSize;
                            }

                            if (labelSpace < labelSize) {
                                // 放不下，中断循环让interval++
                                isEnough = false;
                                break;
                            }
                        }
                    }
                }
                else {
                    // 少于3个则全部显示
                    interval = 1;
                }
            }
            else {
                // 用户自定义间隔
                interval = interval - 0 + 1;
            }

            return interval;
        },
        
        /**
         * 根据选项计算时间链条上的坐标及symbolList
         */
        _getChainPoint: function() {
            var timelineOption = this.timelineOption;
            var symbol = timelineOption.symbol.toLowerCase();
            var symbolSize = timelineOption.symbolSize;
            var rotate = timelineOption.label.rotate;
            var textStyle = timelineOption.label.textStyle;
            var textFont = this.getFont(textStyle);
            var dataTextStyle;
            var data = timelineOption.data;
            var x = this._location.x;
            var y = this._location.y + this._location.height / 4 * 3;
            var width = this._location.x2 - this._location.x;
            var len = data.length;
            
            function _getName(i) {
                return (data[i].name != null ? data[i].name : data[i] + '');
            }
            var xList = [];
            if (len > 1) {
                var boundaryGap = width / len;
                boundaryGap = boundaryGap > 50 ? 50 : (boundaryGap < 20 ? 5 : boundaryGap);
                width -= boundaryGap * 2;
                if (timelineOption.type === 'number') {
                    // 平均分布
                    for (var i = 0; i < len; i++) {
                        xList.push(x + boundaryGap + width / (len - 1) * i);
                    }
                }
                else {
                    // 时间比例
                    xList[0] = new Date(_getName(0).replace(/-/g, '/'));
                    xList[len - 1] = new Date(_getName(len - 1).replace(/-/g, '/')) - xList[0];
                    for (var i = 1; i < len; i++) {
                        xList[i] =  x + boundaryGap 
                                    + width 
                                      * (new Date(_getName(i).replace(/-/g, '/')) - xList[0]) 
                                      / xList[len - 1];
                    }
                    xList[0] = x + boundaryGap;
                }
            }
            else {
                xList.push(x + width / 2);
            }
            
            var list = [];
            var curSymbol;
            var n;
            var isEmpty;
            var textAlign;
            var rotation;
            for (var i = 0; i < len; i++) {
                x = xList[i];
                curSymbol = (data[i].symbol && data[i].symbol.toLowerCase()) || symbol;
                if (curSymbol.match('empty')) {
                    curSymbol = curSymbol.replace('empty', '');
                    isEmpty = true;
                }
                else {
                    isEmpty = false;
                }
                if (curSymbol.match('star')) {
                    n = (curSymbol.replace('star','') - 0) || 5;
                    curSymbol = 'star';
                }
                
                dataTextStyle = data[i].textStyle 
                                ? zrUtil.merge(data[i].textStyle || {}, textStyle)
                                : textStyle;
                
                textAlign = dataTextStyle.align || 'center';
                
                if (rotate) {
                    textAlign = rotate > 0 ? 'right' : 'left';
                    rotation = [rotate * Math.PI / 180, x, y - 5];
                }
                else {
                    rotation = false;
                }
                
                list.push({
                    x: x,
                    n: n,
                    isEmpty: isEmpty,
                    symbol: curSymbol,
                    symbolSize: data[i].symbolSize || symbolSize,
                    color: data[i].color,
                    borderColor: data[i].borderColor,
                    borderWidth: data[i].borderWidth,
                    name: this._getReformedLabel(i),
                    textColor: dataTextStyle.color,
                    textAlign: textAlign,
                    textBaseline: dataTextStyle.baseline || 'middle',
                    textX: x,
                    textY: y - (rotate ? 5 : 0),
                    textFont: data[i].textStyle ? this.getFont(dataTextStyle) : textFont,
                    rotation: rotation,
                    showLabel: false
                });
            }
            
            return list;
        },
        
        _buildBackground: function () {
            var timelineOption = this.timelineOption;
            var padding = this.reformCssArray(this.timelineOption.padding);
            var width = this._location.width;
            var height = this._location.height;
            
            if (timelineOption.borderWidth !== 0 
                || timelineOption.backgroundColor.replace(/\s/g,'') != 'rgba(0,0,0,0)'
            ) {
                // 背景
                this.shapeList.push(new RectangleShape({
                    zlevel: this.getZlevelBase(),
                    z: this.getZBase(),
                    hoverable :false,
                    style: {
                        x: this._location.x - padding[3],
                        y: this._location.y - padding[0],
                        width: width + padding[1] + padding[3],
                        height: height + padding[0] + padding[2],
                        brushType: timelineOption.borderWidth === 0 ? 'fill' : 'both',
                        color: timelineOption.backgroundColor,
                        strokeColor: timelineOption.borderColor,
                        lineWidth: timelineOption.borderWidth
                    }
                }));
            }
        },

        _buildControl: function() {
            var self = this;
            var timelineOption = this.timelineOption;
            var lineStyle = timelineOption.lineStyle;
            var controlStyle = timelineOption.controlStyle;
            if (timelineOption.controlPosition === 'none') {
                return;
            }
            var iconSize = controlStyle.itemSize;
            var iconGap = controlStyle.itemGap;
            var x;
            if (timelineOption.controlPosition === 'left') {
                x = this._location.x;
                this._location.x += (iconSize + iconGap) * 3;
            }
            else {
                x = this._location.x2 - ((iconSize + iconGap) * 3 - iconGap);
                this._location.x2 -= (iconSize + iconGap) * 3;
            }
            
            var y = this._location.y;
            var iconStyle = {
                zlevel: this.getZlevelBase(),
                z: this.getZBase() + 1,
                style: {
                    iconType: 'timelineControl',
                    symbol: 'last',
                    x: x,
                    y: y,
                    width: iconSize,
                    height: iconSize,
                    brushType: 'stroke',
                    color: controlStyle.normal.color,
                    strokeColor: controlStyle.normal.color,
                    lineWidth: lineStyle.width
                },
                highlightStyle: {
                    color: controlStyle.emphasis.color,
                    strokeColor: controlStyle.emphasis.color,
                    lineWidth: lineStyle.width + 1
                },
                clickable: true
            };
            
            this._ctrLastShape = new IconShape(iconStyle);
            this._ctrLastShape.onclick = function() {
                self.last();
            };
            this.shapeList.push(this._ctrLastShape);
            
            x += iconSize + iconGap;
            this._ctrPlayShape = new IconShape(zrUtil.clone(iconStyle));
            this._ctrPlayShape.style.brushType = 'fill';
            this._ctrPlayShape.style.symbol = 'play';
            this._ctrPlayShape.style.status = this.timelineOption.autoPlay ? 'playing' : 'stop';
            this._ctrPlayShape.style.x = x;
            this._ctrPlayShape.onclick = function() {
                if (self._ctrPlayShape.style.status === 'stop') {
                    self.play();
                }
                else {
                    self.stop();
                }
            };
            this.shapeList.push(this._ctrPlayShape);
            
            x += iconSize + iconGap;
            this._ctrNextShape = new IconShape(zrUtil.clone(iconStyle));
            this._ctrNextShape.style.symbol = 'next';
            this._ctrNextShape.style.x = x;
            this._ctrNextShape.onclick = function() {
                self.next();
            };
            this.shapeList.push(this._ctrNextShape);
        },
        
        /**
         * 构建时间轴
         */
        _buildChain: function () {
            var timelineOption = this.timelineOption;
            var lineStyle = timelineOption.lineStyle;
            this._timelineShae = {
                zlevel: this.getZlevelBase(),
                z: this.getZBase(),
                style: {
                    x: this._location.x,
                    y: this.subPixelOptimize(this._location.y, lineStyle.width),
                    width: this._location.x2 - this._location.x,
                    height: this._location.height,
                    chainPoint: this._chainPoint,
                    brushType:'both',
                    strokeColor: lineStyle.color,
                    lineWidth: lineStyle.width,
                    lineType: lineStyle.type
                },
                hoverable: false,
                clickable: true,
                onclick: this._onclick
            };

            this._timelineShae = new ChainShape(this._timelineShae);
            this.shapeList.push(this._timelineShae);
        },

        /**
         * 构建拖拽手柄
         */
        _buildHandle: function () {
            var curPoint = this._chainPoint[this.currentIndex];
            var symbolSize = curPoint.symbolSize + 1;
            symbolSize = symbolSize < 5 ? 5 : symbolSize;
            
            this._handleShape = {
                zlevel: this.getZlevelBase(),
                z: this.getZBase() + 1,
                hoverable: false,
                draggable: true,
                style: {
                    iconType: 'diamond',
                    n: curPoint.n,
                    x: curPoint.x - symbolSize,
                    y: this._location.y + this._location.height / 4 - symbolSize,
                    width: symbolSize * 2,
                    height: symbolSize * 2,
                    brushType:'both',
                    textPosition: 'specific',
                    textX: curPoint.x,
                    textY: this._location.y - this._location.height / 4,
                    textAlign: 'center',
                    textBaseline: 'middle'
                },
                highlightStyle: {},
                ondrift: this._ondrift,
                ondragend: this._ondragend
            };
            
            this._handleShape = new IconShape(this._handleShape);
            this.shapeList.push(this._handleShape);
        },
        
        /**
         * 同步拖拽图形样式 
         */
        _syncHandleShape: function() {
            if (!this.timelineOption.show) {
                return;
            }
            
            var timelineOption = this.timelineOption;
            var cpStyle = timelineOption.checkpointStyle;
            var curPoint = this._chainPoint[this.currentIndex];

            this._handleShape.style.text = cpStyle.label.show ? curPoint.name : '';
            this._handleShape.style.textFont = curPoint.textFont;
            
            this._handleShape.style.n = curPoint.n;
            if (cpStyle.symbol === 'auto') {
                this._handleShape.style.iconType = curPoint.symbol != 'none' 
                                                   ? curPoint.symbol : 'diamond';
            }
            else {
                this._handleShape.style.iconType = cpStyle.symbol;
                if (cpStyle.symbol.match('star')) {
                    this._handleShape.style.n = (cpStyle.symbol.replace('star','') - 0) || 5;
                    this._handleShape.style.iconType = 'star';
                }
            }
            
            var symbolSize;
            if (cpStyle.symbolSize === 'auto') {
                symbolSize = curPoint.symbolSize + 2;
                symbolSize = symbolSize < 5 ? 5 : symbolSize;
            }
            else {
                symbolSize = cpStyle.symbolSize - 0;
            }
            
            this._handleShape.style.color = cpStyle.color === 'auto'
                                            ? (curPoint.color 
                                               ? curPoint.color 
                                               : timelineOption.controlStyle.emphasis.color
                                              )
                                            : cpStyle.color;
            this._handleShape.style.textColor = cpStyle.label.textStyle.color === 'auto'
                                                ? this._handleShape.style.color
                                                : cpStyle.label.textStyle.color;
            this._handleShape.highlightStyle.strokeColor = 
            this._handleShape.style.strokeColor = cpStyle.borderColor === 'auto'
                                ? (curPoint.borderColor ? curPoint.borderColor : '#fff')
                                : cpStyle.borderColor;
            this._handleShape.style.lineWidth = cpStyle.borderWidth === 'auto'
                                ? (curPoint.borderWidth ? curPoint.borderWidth : 0)
                                : (cpStyle.borderWidth - 0);
            this._handleShape.highlightStyle.lineWidth = this._handleShape.style.lineWidth + 1;
            
            this.zr.animate(this._handleShape.id, 'style')
                .when(
                    500,
                    {
                        x: curPoint.x - symbolSize,
                        textX: curPoint.x,
                        y: this._location.y + this._location.height / 4 - symbolSize,
                        width: symbolSize * 2,
                        height: symbolSize * 2
                    }
                )
                .start('ExponentialOut');
        },

        _findChainIndex: function(x) {
            var chainPoint = this._chainPoint;
            var len = chainPoint.length;
            if (x <= chainPoint[0].x) {
                return 0;
            }
            else if (x >= chainPoint[len - 1].x) {
                return len - 1;
            }
            for (var i = 0; i < len - 1; i++) {
                if (x >= chainPoint[i].x && x <= chainPoint[i + 1].x) {
                    // catch you！
                    return (Math.abs(x - chainPoint[i].x) < Math.abs(x - chainPoint[i + 1].x))
                           ? i : (i + 1);
                }
            }
        },
        
        __onclick: function(param) {
            var x = zrEvent.getX(param.event);
            var newIndex =  this._findChainIndex(x);
            if (newIndex === this.currentIndex) {
                return true; // 啥事都没发生
            }
            
            this.currentIndex = newIndex;
            this.timelineOption.autoPlay && this.stop(); // 停止自动播放
            clearTimeout(this.playTicket);
            this._onFrame();
        },
        
        /**
         * 拖拽范围控制
         */
        __ondrift: function (shape, dx) {
            this.timelineOption.autoPlay && this.stop(); // 停止自动播放
            
            var chainPoint = this._chainPoint;
            var len = chainPoint.length;
            var newIndex;
            if (shape.style.x + dx <= chainPoint[0].x - chainPoint[0].symbolSize) {
                shape.style.x = chainPoint[0].x - chainPoint[0].symbolSize;
                newIndex = 0;
            }
            else if (shape.style.x + dx >= chainPoint[len - 1].x - chainPoint[len - 1].symbolSize) {
                shape.style.x = chainPoint[len - 1].x - chainPoint[len - 1].symbolSize;
                newIndex = len - 1;
            }
            else {
                shape.style.x += dx;
                newIndex = this._findChainIndex(shape.style.x);
            }
            var curPoint = chainPoint[newIndex];
            var symbolSize = curPoint.symbolSize + 2;
            shape.style.iconType = curPoint.symbol;
            shape.style.n = curPoint.n;
            shape.style.textX = shape.style.x + symbolSize / 2;
            shape.style.y = this._location.y + this._location.height / 4 - symbolSize;
            shape.style.width = symbolSize * 2;
            shape.style.height = symbolSize * 2;
            shape.style.text = curPoint.name;
            
            //console.log(newIndex)
            if (newIndex === this.currentIndex) {
                return true; // 啥事都没发生
            }
            
            this.currentIndex = newIndex;
            if (this.timelineOption.realtime) {
                clearTimeout(this.playTicket);
                var self = this;
                this.playTicket = setTimeout(function() {
                    self._setCurrentOption();
                },200);
            }

            return true;
        },
        
        __ondragend: function () {
            this.isDragend = true;
        },
        
        /**
         * 数据项被拖拽出去
         */
        ondragend: function (param, status) {
            if (!this.isDragend || !param.target) {
                // 没有在当前实例上发生拖拽行为则直接返回
                return;
            }
            !this.timelineOption.realtime && this._setCurrentOption();
            
            // 别status = {}赋值啊！！
            status.dragOut = true;
            status.dragIn = true;
            status.needRefresh = false; // 会有消息触发fresh，不用再刷一遍
            // 处理完拖拽事件后复位
            this.isDragend = false;
            this._syncHandleShape();
            return;
        },
        
        last: function () {
            this.timelineOption.autoPlay && this.stop(); // 停止自动播放
            
            this.currentIndex -= 1;
            if (this.currentIndex < 0) {
                this.currentIndex = this.timelineOption.data.length - 1;
            }
            this._onFrame();
            
            return this.currentIndex;
        },
        
        next: function () {
            this.timelineOption.autoPlay && this.stop(); // 停止自动播放
            
            this.currentIndex += 1;
            if (this.currentIndex >= this.timelineOption.data.length) {
                this.currentIndex = 0;
            }
            this._onFrame();
            
            return this.currentIndex;
        },
        
        play: function (targetIndex, autoPlay) {
            if (this._ctrPlayShape && this._ctrPlayShape.style.status != 'playing') {
                this._ctrPlayShape.style.status = 'playing';
                this.zr.modShape(this._ctrPlayShape.id);
                this.zr.refreshNextFrame();
            }
            
            
            this.timelineOption.autoPlay = autoPlay != null ? autoPlay : true;
            
            if (!this.timelineOption.autoPlay) {
                clearTimeout(this.playTicket);
            }
            
            this.currentIndex = targetIndex != null ? targetIndex : (this.currentIndex + 1);
            if (this.currentIndex >= this.timelineOption.data.length) {
                this.currentIndex = 0;
            }
            this._onFrame();
            
            return this.currentIndex;
        },
        
        stop: function () {
            if (this._ctrPlayShape && this._ctrPlayShape.style.status != 'stop') {
                this._ctrPlayShape.style.status = 'stop';
                this.zr.modShape(this._ctrPlayShape.id);
                this.zr.refreshNextFrame();
            }
            
            this.timelineOption.autoPlay = false;
            
            clearTimeout(this.playTicket);
            
            return this.currentIndex;
        },
        
        /**
         * 避免dataZoom带来两次refresh，不设refresh接口，resize重复一下buildshape逻辑 
         */
        resize: function () {
            if (this.timelineOption.show) {
                this.clear();
                this._buildShape();
                this._syncHandleShape();
            }
        },
        
        setTheme: function(needRefresh) {
            this.timelineOption = this.reformOption(zrUtil.clone(this.option.timeline));
            // 通用字体设置
            this.timelineOption.label.textStyle = this.getTextStyle(
                this.timelineOption.label.textStyle
            );
            this.timelineOption.checkpointStyle.label.textStyle = this.getTextStyle(
                this.timelineOption.checkpointStyle.label.textStyle
            );
            if (!this.myChart.canvasSupported) {
                // 不支持Canvas的强制关闭实时动画
                this.timelineOption.realtime = false;
            }
            
            if (this.timelineOption.show && needRefresh) {
                this.clear();
                this._buildShape();
                this._syncHandleShape();
            }
        },
        
        /**
         * 释放后实例不可用，重载基类方法
         */
        onbeforDispose: function () {
            clearTimeout(this.playTicket);
        }
    };
    
    function timelineControl(ctx, style) {
        var lineWidth = 2;//style.lineWidth;
        var x = style.x + lineWidth;
        var y = style.y + lineWidth + 2;
        var width = style.width - lineWidth;
        var height = style.height - lineWidth;
        
        
        var symbol = style.symbol;
        if (symbol === 'last') {
            ctx.moveTo(x + width - 2, y + height / 3);
            ctx.lineTo(x + width - 2, y);
            ctx.lineTo(x + 2, y + height / 2);
            ctx.lineTo(x + width - 2, y + height);
            ctx.lineTo(x + width - 2, y + height / 3 * 2);
            ctx.moveTo(x, y);
            ctx.lineTo(x, y);
        } 
        else if (symbol === 'next') {
            ctx.moveTo(x + 2, y + height / 3);
            ctx.lineTo(x + 2, y);
            ctx.lineTo(x + width - 2, y + height / 2);
            ctx.lineTo(x + 2, y + height);
            ctx.lineTo(x + 2, y + height / 3 * 2);
            ctx.moveTo(x, y);
            ctx.lineTo(x, y);
        }
        else if (symbol === 'play') {
            if (style.status === 'stop') {
                ctx.moveTo(x + 2, y);
                ctx.lineTo(x + width - 2, y + height / 2);
                ctx.lineTo(x + 2, y + height);
                ctx.lineTo(x + 2, y);
            }
            else {
                var delta = style.brushType === 'both' ? 2 : 3;
                ctx.rect(x + 2, y, delta, height);
                ctx.rect(x + width - delta - 2, y, delta, height);
            }
        }
        else if (symbol.match('image')) {
            var imageLocation = '';
            imageLocation = symbol.replace(
                    new RegExp('^image:\\/\\/'), ''
                );
            symbol = IconShape.prototype.iconLibrary.image;
            symbol(ctx, {
                x: x,
                y: y,
                width: width,
                height: height,
                image: imageLocation
            });
        }
    }
    IconShape.prototype.iconLibrary['timelineControl'] = timelineControl;
    
    zrUtil.inherits(Timeline, Base);
    
    require('../component').define('timeline', Timeline);
    
    return Timeline;
});
define('echarts/component', [], function (/*require*/) {     // component
    var self = {};

    var _componentLibrary = {};     // echart组件库

    /**
     * 定义图形实现
     * @param {Object} name
     * @param {Object} clazz 图形实现
     */
    self.define = function (name, clazz) {
        _componentLibrary[name] = clazz;
        return self;
    };

    /**
     * 获取图形实现
     * @param {Object} name
     */
    self.get = function (name) {
        return _componentLibrary[name];
    };
    
    return self;
});
define('echarts/component/title', ['require', './base', 'zrender/shape/Text', 'zrender/shape/Rectangle', '../config', 'zrender/tool/util', 'zrender/tool/area', 'zrender/tool/color', '../component'], function (require) {
    var Base = require('./base');
    
    // 图形依赖
    var TextShape = require('zrender/shape/Text');
    var RectangleShape = require('zrender/shape/Rectangle');
    
    var ecConfig = require('../config');
    // 图表标题
    ecConfig.title = {
        zlevel: 0,                  // 一级层叠
        z: 6,                       // 二级层叠
        show: true,
        text: '',
        // link: null,             // 超链接跳转
        // target: null,           // 仅支持self | blank
        subtext: '',
        // sublink: null,          // 超链接跳转
        // subtarget: null,        // 仅支持self | blank
        x: 'left',                 // 水平安放位置，默认为左对齐，可选为：
                                   // 'center' ¦ 'left' ¦ 'right'
                                   // ¦ {number}（x坐标，单位px）
        y: 'top',                  // 垂直安放位置，默认为全图顶端，可选为：
                                   // 'top' ¦ 'bottom' ¦ 'center'
                                   // ¦ {number}（y坐标，单位px）
        //textAlign: null          // 水平对齐方式，默认根据x设置自动调整
        backgroundColor: 'rgba(0,0,0,0)',
        borderColor: '#ccc',       // 标题边框颜色
        borderWidth: 0,            // 标题边框线宽，单位px，默认为0（无边框）
        padding: 5,                // 标题内边距，单位px，默认各方向内边距为5，
                                   // 接受数组分别设定上右下左边距，同css
        itemGap: 5,                // 主副标题纵向间隔，单位px，默认为10，
        textStyle: {
            fontSize: 18,
            fontWeight: 'bolder',
            color: '#333'          // 主标题文字颜色
        },
        subtextStyle: {
            color: '#aaa'          // 副标题文字颜色
        }
    };
    
    var zrUtil = require('zrender/tool/util');
    var zrArea = require('zrender/tool/area');
    var zrColor = require('zrender/tool/color');
    
    /**
     * 构造函数
     * @param {Object} messageCenter echart消息中心
     * @param {ZRender} zr zrender实例
     * @param {Object} option 图表参数
     */
    function Title(ecTheme, messageCenter, zr, option, myChart) {
        Base.call(this, ecTheme, messageCenter, zr, option, myChart);
        
        this.refresh(option);
    }
    
    Title.prototype = {
        type: ecConfig.COMPONENT_TYPE_TITLE,
        _buildShape: function () {
            if (!this.titleOption.show) {
                return;
            }
            // 标题元素组的位置参数，通过计算所得x, y, width, height
            this._itemGroupLocation = this._getItemGroupLocation();

            this._buildBackground();
            this._buildItem();

            for (var i = 0, l = this.shapeList.length; i < l; i++) {
                this.zr.addShape(this.shapeList[i]);
            }
        },

        /**
         * 构建所有标题元素
         */
        _buildItem: function () {
            var text = this.titleOption.text;
            var link = this.titleOption.link;
            var target = this.titleOption.target;
            var subtext = this.titleOption.subtext;
            var sublink = this.titleOption.sublink;
            var subtarget = this.titleOption.subtarget;
            var font = this.getFont(this.titleOption.textStyle);
            var subfont = this.getFont(this.titleOption.subtextStyle);
            
            var x = this._itemGroupLocation.x;
            var y = this._itemGroupLocation.y;
            var width = this._itemGroupLocation.width;
            var height = this._itemGroupLocation.height;
            
            var textShape = {
                zlevel: this.getZlevelBase(),
                z: this.getZBase(),
                style: {
                    y: y,
                    color: this.titleOption.textStyle.color,
                    text: text,
                    textFont: font,
                    textBaseline: 'top'
                },
                highlightStyle: {
                    color: zrColor.lift(this.titleOption.textStyle.color, 1),
                    brushType: 'fill'
                },
                hoverable: false
            };
            if (link) {
                textShape.hoverable = true;
                textShape.clickable = true;
                textShape.onclick = function (){
                    if (!target || target != 'self') {
                        window.open(link);
                    }
                    else {
                        window.location = link;
                    }
                };
            }
            
            var subtextShape = {
                zlevel: this.getZlevelBase(),
                z: this.getZBase(),
                style: {
                    y: y + height,
                    color: this.titleOption.subtextStyle.color,
                    text: subtext,
                    textFont: subfont,
                    textBaseline: 'bottom'
                },
                highlightStyle: {
                    color: zrColor.lift(this.titleOption.subtextStyle.color, 1),
                    brushType: 'fill'
                },
                hoverable: false
            };
            if (sublink) {
                subtextShape.hoverable = true;
                subtextShape.clickable = true;
                subtextShape.onclick = function (){
                    if (!subtarget || subtarget != 'self') {
                        window.open(sublink);
                    }
                    else {
                        window.location = sublink;
                    }
                };
            }

            switch (this.titleOption.x) {
                case 'center' :
                    textShape.style.x = subtextShape.style.x = x + width / 2;
                    textShape.style.textAlign = subtextShape.style.textAlign 
                                              = 'center';
                    break;
                case 'left' :
                    textShape.style.x = subtextShape.style.x = x;
                    textShape.style.textAlign = subtextShape.style.textAlign 
                                              = 'left';
                    break;
                case 'right' :
                    textShape.style.x = subtextShape.style.x = x + width;
                    textShape.style.textAlign = subtextShape.style.textAlign 
                                              = 'right';
                    break;
                default :
                    x = this.titleOption.x - 0;
                    x = isNaN(x) ? 0 : x;
                    textShape.style.x = subtextShape.style.x = x;
                    break;
            }
            
            if (this.titleOption.textAlign) {
                textShape.style.textAlign = subtextShape.style.textAlign 
                                          = this.titleOption.textAlign;
            }

            this.shapeList.push(new TextShape(textShape));
            subtext !== '' && this.shapeList.push(new TextShape(subtextShape));
        },

        _buildBackground: function () {
            var padding = this.reformCssArray(this.titleOption.padding);

            this.shapeList.push(new RectangleShape({
                zlevel: this.getZlevelBase(),
                z: this.getZBase(),
                hoverable :false,
                style: {
                    x: this._itemGroupLocation.x - padding[3],
                    y: this._itemGroupLocation.y - padding[0],
                    width: this._itemGroupLocation.width + padding[3] + padding[1],
                    height: this._itemGroupLocation.height + padding[0] + padding[2],
                    brushType: this.titleOption.borderWidth === 0 ? 'fill' : 'both',
                    color: this.titleOption.backgroundColor,
                    strokeColor: this.titleOption.borderColor,
                    lineWidth: this.titleOption.borderWidth
                }
            }));
        },

        /**
         * 根据选项计算标题实体的位置坐标
         */
        _getItemGroupLocation: function () {
            var padding = this.reformCssArray(this.titleOption.padding);
            var text = this.titleOption.text;
            var subtext = this.titleOption.subtext;
            var font = this.getFont(this.titleOption.textStyle);
            var subfont = this.getFont(this.titleOption.subtextStyle);
            
            var totalWidth = Math.max(
                    zrArea.getTextWidth(text, font),
                    zrArea.getTextWidth(subtext, subfont)
                );
            var totalHeight = zrArea.getTextHeight(text, font)
                              + (subtext === ''
                                 ? 0
                                 : (this.titleOption.itemGap
                                    + zrArea.getTextHeight(subtext, subfont))
                                );

            var x;
            var zrWidth = this.zr.getWidth();
            switch (this.titleOption.x) {
                case 'center' :
                    x = Math.floor((zrWidth - totalWidth) / 2);
                    break;
                case 'left' :
                    x = padding[3] + this.titleOption.borderWidth;
                    break;
                case 'right' :
                    x = zrWidth
                        - totalWidth
                        - padding[1]
                        - this.titleOption.borderWidth;
                    break;
                default :
                    x = this.titleOption.x - 0;
                    x = isNaN(x) ? 0 : x;
                    break;
            }

            var y;
            var zrHeight = this.zr.getHeight();
            switch (this.titleOption.y) {
                case 'top' :
                    y = padding[0] + this.titleOption.borderWidth;
                    break;
                case 'bottom' :
                    y = zrHeight
                        - totalHeight
                        - padding[2]
                        - this.titleOption.borderWidth;
                    break;
                case 'center' :
                    y = Math.floor((zrHeight - totalHeight) / 2);
                    break;
                default :
                    y = this.titleOption.y - 0;
                    y = isNaN(y) ? 0 : y;
                    break;
            }

            return {
                x: x,
                y: y,
                width: totalWidth,
                height: totalHeight
            };
        },
        
        /**
         * 刷新
         */
        refresh: function (newOption) {
            if (newOption) {
                this.option = newOption;

                this.option.title = this.reformOption(this.option.title);
                this.titleOption = this.option.title;
                this.titleOption.textStyle = this.getTextStyle(
                    this.titleOption.textStyle
                );
                this.titleOption.subtextStyle = this.getTextStyle(
                    this.titleOption.subtextStyle
                );
            }
            
            this.clear();
            this._buildShape();
        }
    };
    
    zrUtil.inherits(Title, Base);
    
    require('../component').define('title', Title);
    
    return Title;
});
define('zrender/loadingEffect/Bar', ['require', './Base', '../tool/util', '../tool/color', '../shape/Rectangle'], function (require) {
        var Base = require('./Base');
        var util = require('../tool/util');
        var zrColor = require('../tool/color');
        var RectangleShape = require('../shape/Rectangle');

        function Bar(options) {
            Base.call(this, options);
        }
        util.inherits(Bar, Base);

        
        /**
         * 进度条
         * 
         * @param {Object} addShapeHandle
         * @param {Object} refreshHandle
         */
        Bar.prototype._start = function (addShapeHandle, refreshHandle) {
            // 特效默认配置
            var options = util.merge(
                this.options,
                {
                    textStyle : {
                        color : '#888'
                    },
                    backgroundColor : 'rgba(250, 250, 250, 0.8)',
                    effectOption : {
                        x : 0,
                        y : this.canvasHeight / 2 - 30,
                        width : this.canvasWidth,
                        height : 5,
                        brushType : 'fill',
                        timeInterval : 100
                    }
                }
            );

            var textShape = this.createTextShape(options.textStyle);
            var background = this.createBackgroundShape(options.backgroundColor);

            var effectOption = options.effectOption;

            // 初始化动画元素
            var barShape = new RectangleShape({
                highlightStyle : util.clone(effectOption)
            });

            barShape.highlightStyle.color =
                effectOption.color
                || zrColor.getLinearGradient(
                    effectOption.x,
                    effectOption.y,
                    effectOption.x + effectOption.width,
                    effectOption.y + effectOption.height,
                    [ [ 0, '#ff6400' ], [ 0.5, '#ffe100' ], [ 1, '#b1ff00' ] ]
                );

            if (options.progress != null) {
                // 指定进度
                addShapeHandle(background);

                barShape.highlightStyle.width =
                    this.adjust(options.progress, [ 0, 1 ])
                    * options.effectOption.width;
                    
                addShapeHandle(barShape);
                addShapeHandle(textShape);

                refreshHandle();
                return;
            }
            else {
                // 循环显示
                barShape.highlightStyle.width = 0;
                return setInterval(
                    function () {
                        addShapeHandle(background);

                        if (barShape.highlightStyle.width < effectOption.width) {
                            barShape.highlightStyle.width += 8;
                        }
                        else {
                            barShape.highlightStyle.width = 0;
                        }
                        addShapeHandle(barShape);
                        addShapeHandle(textShape);
                        refreshHandle();
                    },
                    effectOption.timeInterval
                );
            }
        };

        return Bar;
    });
define('zrender/shape/Image', ['require', './Base', '../tool/util'], function (require) {

        var Base = require('./Base');

        /**
         * @alias zrender/shape/Image
         * @constructor
         * @extends module:zrender/shape/Base
         * @param {Object} options
         */
        var ZImage = function(options) {
            Base.call(this, options);
            /**
             * 图片绘制样式
             * @name module:zrender/shape/Image#style
             * @type {module:zrender/shape/Image~IImageStyle}
             */
            /**
             * 图片高亮绘制样式
             * @name module:zrender/shape/Image#highlightStyle
             * @type {module:zrender/shape/Image~IImageStyle}
             */
        };

        ZImage.prototype = {
            
            type: 'image',

            brush : function(ctx, isHighlight, refreshNextFrame) {
                var style = this.style || {};

                if (isHighlight) {
                    // 根据style扩展默认高亮样式
                    style = this.getHighlightStyle(
                        style, this.highlightStyle || {}
                    );
                }

                var image = style.image;
                var self = this;

                if (!this._imageCache) {
                    this._imageCache = {};
                }
                if (typeof(image) === 'string') {
                    var src = image;
                    if (this._imageCache[src]) {
                        image = this._imageCache[src];
                    } else {
                        image = new Image();
                        image.onload = function () {
                            image.onload = null;
                            self.modSelf();
                            refreshNextFrame();
                        };

                        image.src = src;
                        this._imageCache[src] = image;
                    }
                }
                if (image) {
                    // 图片已经加载完成
                    if (image.nodeName.toUpperCase() == 'IMG') {
                        if (window.ActiveXObject) {
                            if (image.readyState != 'complete') {
                                return;
                            }
                        }
                        else {
                            if (!image.complete) {
                                return;
                            }
                        }
                    }
                    // Else is canvas
                    var width = style.width || image.width;
                    var height = style.height || image.height;
                    var x = style.x;
                    var y = style.y;
                    // 图片加载失败
                    if (!image.width || !image.height) {
                        return;
                    }

                    ctx.save();

                    this.doClip(ctx);

                    this.setContext(ctx, style);

                    // 设置transform
                    this.setTransform(ctx);

                    if (style.sWidth && style.sHeight) {
                        var sx = style.sx || 0;
                        var sy = style.sy || 0;
                        ctx.drawImage(
                            image,
                            sx, sy, style.sWidth, style.sHeight,
                            x, y, width, height
                        );
                    }
                    else if (style.sx && style.sy) {
                        var sx = style.sx;
                        var sy = style.sy;
                        var sWidth = width - sx;
                        var sHeight = height - sy;
                        ctx.drawImage(
                            image,
                            sx, sy, sWidth, sHeight,
                            x, y, width, height
                        );
                    }
                    else {
                        ctx.drawImage(image, x, y, width, height);
                    }
                    // 如果没设置宽和高的话自动根据图片宽高设置
                    if (!style.width) {
                        style.width = width;
                    }
                    if (!style.height) {
                        style.height = height;
                    }
                    if (!this.style.width) {
                        this.style.width = width;
                    }
                    if (!this.style.height) {
                        this.style.height = height;
                    }

                    this.drawText(ctx, style, this.style);

                    ctx.restore();
                }
            },

            /**
             * 计算返回图片的包围盒矩形
             * @param {module:zrender/shape/Image~IImageStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect: function(style) {
                return {
                    x : style.x,
                    y : style.y,
                    width : style.width,
                    height : style.height
                };
            },

            clearCache: function() {
                this._imageCache = {};
            }
        };

        require('../tool/util').inherits(ZImage, Base);
        return ZImage;
    });
define('zrender/loadingEffect/Bubble', ['require', './Base', '../tool/util', '../tool/color', '../shape/Circle'], function (require) {
        var Base = require('./Base');
        var util = require('../tool/util');
        var zrColor = require('../tool/color');
        var CircleShape = require('../shape/Circle');

        function Bubble(options) {
            Base.call(this, options);
        }
        util.inherits(Bubble, Base);

        /**
         * 泡泡
         *
         * @param {Object} addShapeHandle
         * @param {Object} refreshHandle
         */
        Bubble.prototype._start = function (addShapeHandle, refreshHandle) {
            
            // 特效默认配置
            var options = util.merge(
                this.options,
                {
                    textStyle : {
                        color : '#888'
                    },
                    backgroundColor : 'rgba(250, 250, 250, 0.8)',
                    effect : {
                        n : 50,
                        lineWidth : 2,
                        brushType : 'stroke',
                        color : 'random',
                        timeInterval : 100
                    }
                }
            );

            var textShape = this.createTextShape(options.textStyle);
            var background = this.createBackgroundShape(options.backgroundColor);

            var effectOption = options.effect;
            var n = effectOption.n;
            var brushType = effectOption.brushType;
            var lineWidth = effectOption.lineWidth;

            var shapeList = [];
            var canvasWidth = this.canvasWidth;
            var canvasHeight = this.canvasHeight;
            
            // 初始化动画元素
            for (var i = 0; i < n; i++) {
                var color = effectOption.color == 'random'
                    ? zrColor.alpha(zrColor.random(), 0.3)
                    : effectOption.color;

                shapeList[i] = new CircleShape({
                    highlightStyle : {
                        x : Math.ceil(Math.random() * canvasWidth),
                        y : Math.ceil(Math.random() * canvasHeight),
                        r : Math.ceil(Math.random() * 40),
                        brushType : brushType,
                        color : color,
                        strokeColor : color,
                        lineWidth : lineWidth
                    },
                    animationY : Math.ceil(Math.random() * 20)
                });
            }
            
            return setInterval(
                function () {
                    addShapeHandle(background);
                    
                    for (var i = 0; i < n; i++) {
                        var style = shapeList[i].highlightStyle;

                        if (style.y - shapeList[i].animationY + style.r <= 0) {
                            shapeList[i].highlightStyle.y = canvasHeight + style.r;
                            shapeList[i].highlightStyle.x = Math.ceil(
                                Math.random() * canvasWidth
                            );
                        }
                        shapeList[i].highlightStyle.y -=
                            shapeList[i].animationY;

                        addShapeHandle(shapeList[i]);
                    }

                    addShapeHandle(textShape);
                    refreshHandle();
                },
                effectOption.timeInterval
            );
        };

        return Bubble;
    });
define('zrender/loadingEffect/DynamicLine', ['require', './Base', '../tool/util', '../tool/color', '../shape/Line'], function (require) {
        var Base = require('./Base');
        var util = require('../tool/util');
        var zrColor = require('../tool/color');
        var LineShape = require('../shape/Line');

        function DynamicLine(options) {
            Base.call(this, options);
        }
        util.inherits(DynamicLine, Base);


        /**
         * 动态线
         * 
         * @param {Object} addShapeHandle
         * @param {Object} refreshHandle
         */
        DynamicLine.prototype._start = function (addShapeHandle, refreshHandle) {
            // 特效默认配置
            var options = util.merge(
                this.options,
                {
                    textStyle : {
                        color : '#fff'
                    },
                    backgroundColor : 'rgba(0, 0, 0, 0.8)',
                    effectOption : {
                        n : 30,
                        lineWidth : 1,
                        color : 'random',
                        timeInterval : 100
                    }
                }
            );

            var textShape = this.createTextShape(options.textStyle);
            var background = this.createBackgroundShape(options.backgroundColor);

            var effectOption = options.effectOption;
            var n = effectOption.n;
            var lineWidth = effectOption.lineWidth;

            var shapeList = [];
            var canvasWidth = this.canvasWidth;
            var canvasHeight = this.canvasHeight;
            
            // 初始化动画元素
            for (var i = 0; i < n; i++) {
                var xStart = -Math.ceil(Math.random() * 1000);
                var len = Math.ceil(Math.random() * 400);
                var pos = Math.ceil(Math.random() * canvasHeight);

                var color = effectOption.color == 'random'
                    ? zrColor.random()
                    : effectOption.color;
                
                shapeList[i] = new LineShape({
                    highlightStyle : {
                        xStart : xStart,
                        yStart : pos,
                        xEnd : xStart + len,
                        yEnd : pos,
                        strokeColor : color,
                        lineWidth : lineWidth
                    },
                    animationX : Math.ceil(Math.random() * 100),
                    len : len
                });
            }
            
            return setInterval(
                function() {
                    addShapeHandle(background);
                    
                    for (var i = 0; i < n; i++) {
                        var style = shapeList[i].highlightStyle;

                        if (style.xStart >= canvasWidth) {
                            
                            shapeList[i].len = Math.ceil(Math.random() * 400);
                            style.xStart = -400;
                            style.xEnd = -400 + shapeList[i].len;
                            style.yStart = Math.ceil(Math.random() * canvasHeight);
                            style.yEnd = style.yStart;
                        }

                        style.xStart += shapeList[i].animationX;
                        style.xEnd += shapeList[i].animationX;

                        addShapeHandle(shapeList[i]);
                    }

                    addShapeHandle(textShape);
                    refreshHandle();
                },
                effectOption.timeInterval
            );
        };

        return DynamicLine;
    });
define('zrender/loadingEffect/Ring', ['require', './Base', '../tool/util', '../tool/color', '../shape/Ring', '../shape/Sector'], function (require) {
        var Base = require('./Base');
        var util = require('../tool/util');
        var zrColor = require('../tool/color');
        var RingShape = require('../shape/Ring');
        var SectorShape = require('../shape/Sector');

        function Ring(options) {
            Base.call(this, options);
        }
        util.inherits(Ring, Base);


        /**
         * 圆环
         * 
         * @param {Object} addShapeHandle
         * @param {Object} refreshHandle
         */
        Ring.prototype._start = function (addShapeHandle, refreshHandle) {
            
            // 特效默认配置
            var options = util.merge(
                this.options,
                {
                    textStyle : {
                        color : '#07a'
                    },
                    backgroundColor : 'rgba(250, 250, 250, 0.8)',
                    effect : {
                        x : this.canvasWidth / 2,
                        y : this.canvasHeight / 2,
                        r0 : 60,
                        r : 100,
                        color : '#bbdcff',
                        brushType: 'fill',
                        textPosition : 'inside',
                        textFont : 'normal 30px verdana',
                        textColor : 'rgba(30, 144, 255, 0.6)',
                        timeInterval : 100
                    }
                }
            );

            var effectOption = options.effect;

            var textStyle = options.textStyle;
            if (textStyle.x == null) {
                textStyle.x = effectOption.x;
            }
            if (textStyle.y == null) {
                textStyle.y = (effectOption.y + (effectOption.r0 + effectOption.r) / 2 - 5);
            }
            
            var textShape = this.createTextShape(options.textStyle);
            var background = this.createBackgroundShape(options.backgroundColor);

            var x = effectOption.x;
            var y = effectOption.y;
            var r0 = effectOption.r0 + 6;
            var r = effectOption.r - 6;
            var color = effectOption.color;
            var darkColor = zrColor.lift(color, 0.1);

            var shapeRing = new RingShape({
                highlightStyle : util.clone(effectOption)
            });

            // 初始化动画元素
            var shapeList = [];
            var clolrList = zrColor.getGradientColors(
                [ '#ff6400', '#ffe100', '#97ff00' ], 25
            );
            var preAngle = 15;
            var endAngle = 240;

            for (var i = 0; i < 16; i++) {
                shapeList.push(new SectorShape({
                    highlightStyle  : {
                        x : x,
                        y : y,
                        r0 : r0,
                        r : r,
                        startAngle : endAngle - preAngle,
                        endAngle : endAngle,
                        brushType: 'fill',
                        color : darkColor
                    },
                    _color : zrColor.getLinearGradient(
                        x + r0 * Math.cos(endAngle, true),
                        y - r0 * Math.sin(endAngle, true),
                        x + r0 * Math.cos(endAngle - preAngle, true),
                        y - r0 * Math.sin(endAngle - preAngle, true),
                        [
                            [ 0, clolrList[i * 2] ],
                            [ 1, clolrList[i * 2 + 1] ]
                        ]
                    )
                }));
                endAngle -= preAngle;
            }
            endAngle = 360;
            for (var i = 0; i < 4; i++) {
                shapeList.push(new SectorShape({
                    highlightStyle  : {
                        x : x,
                        y : y,
                        r0 : r0,
                        r : r,
                        startAngle : endAngle - preAngle,
                        endAngle : endAngle,
                        brushType: 'fill',
                        color : darkColor
                    },
                    _color : zrColor.getLinearGradient(
                        x + r0 * Math.cos(endAngle, true),
                        y - r0 * Math.sin(endAngle, true),
                        x + r0 * Math.cos(endAngle - preAngle, true),
                        y - r0 * Math.sin(endAngle - preAngle, true),
                        [
                            [ 0, clolrList[i * 2 + 32] ],
                            [ 1, clolrList[i * 2 + 33] ]
                        ]
                    )
                }));
                endAngle -= preAngle;
            }

            var n = 0;
            if (options.progress != null) {
                // 指定进度
                addShapeHandle(background);

                n = this.adjust(options.progress, [ 0, 1 ]).toFixed(2) * 100 / 5;
                shapeRing.highlightStyle.text = n * 5 + '%';
                addShapeHandle(shapeRing);

                for (var i = 0; i < 20; i++) {
                    shapeList[i].highlightStyle.color = i < n
                        ? shapeList[i]._color : darkColor;
                    addShapeHandle(shapeList[i]);
                }

                addShapeHandle(textShape);
                refreshHandle();
                return;
            }

            // 循环显示
            return setInterval(
                function() {
                    addShapeHandle(background);

                    n += n >= 20 ? -20 : 1;

                    // shapeRing.highlightStyle.text = n * 5 + '%';
                    addShapeHandle(shapeRing);

                    for (var i = 0; i < 20; i++) {
                        shapeList[i].highlightStyle.color = i < n
                            ? shapeList[i]._color : darkColor;
                        addShapeHandle(shapeList[i]);
                    }

                    addShapeHandle(textShape);
                    refreshHandle();
                },
                effectOption.timeInterval
            );
        };

        return Ring;
    });
define('zrender/loadingEffect/Spin', ['require', './Base', '../tool/util', '../tool/color', '../tool/area', '../shape/Sector'], function (require) {
        var Base = require('./Base');
        var util = require('../tool/util');
        var zrColor = require('../tool/color');
        var zrArea = require('../tool/area');
        var SectorShape = require('../shape/Sector');

        function Spin(options) {
            Base.call(this, options);
        }
        util.inherits(Spin, Base);

        /**
         * 旋转
         * 
         * @param {Object} addShapeHandle
         * @param {Object} refreshHandle
         */
        Spin.prototype._start = function (addShapeHandle, refreshHandle) {
            var options = util.merge(
                this.options,
                {
                    textStyle : {
                        color : '#fff',
                        textAlign : 'start'
                    },
                    backgroundColor : 'rgba(0, 0, 0, 0.8)'
                }
            );
            var textShape = this.createTextShape(options.textStyle);
            
            var textGap = 10;
            var textWidth = zrArea.getTextWidth(
                textShape.highlightStyle.text, textShape.highlightStyle.textFont
            );
            var textHeight = zrArea.getTextHeight(
                textShape.highlightStyle.text, textShape.highlightStyle.textFont
            );
            
            // 特效默认配置
            var effectOption =  util.merge(
                this.options.effect || {},
                {
                    r0 : 9,
                    r : 15,
                    n : 18,
                    color : '#fff',
                    timeInterval : 100
                }
            );
            
            var location = this.getLocation(
                this.options.textStyle,
                textWidth + textGap + effectOption.r * 2,
                Math.max(effectOption.r * 2, textHeight)
            );
            effectOption.x = location.x + effectOption.r;
            effectOption.y = textShape.highlightStyle.y = location.y + location.height / 2;
            textShape.highlightStyle.x = effectOption.x + effectOption.r + textGap;
            
            var background = this.createBackgroundShape(options.backgroundColor);
            var n = effectOption.n;
            var x = effectOption.x;
            var y = effectOption.y;
            var r0 = effectOption.r0;
            var r = effectOption.r;
            var color = effectOption.color;

            // 初始化动画元素
            var shapeList = [];
            var preAngle = Math.round(180 / n);
            for (var i = 0; i < n; i++) {
                shapeList[i] = new SectorShape({
                    highlightStyle  : {
                        x : x,
                        y : y,
                        r0 : r0,
                        r : r,
                        startAngle : preAngle * i * 2,
                        endAngle : preAngle * i * 2 + preAngle,
                        color : zrColor.alpha(color, (i + 1) / n),
                        brushType: 'fill'
                    }
                });
            }

            var pos = [ 0, x, y ];

            return setInterval(
                function() {
                    addShapeHandle(background);
                    pos[0] -= 0.3;
                    for (var i = 0; i < n; i++) {
                        shapeList[i].rotation = pos;
                        addShapeHandle(shapeList[i]);
                    }

                    addShapeHandle(textShape);
                    refreshHandle();
                },
                effectOption.timeInterval
            );
        };

        return Spin;
    });
define('zrender/loadingEffect/Whirling', ['require', './Base', '../tool/util', '../tool/area', '../shape/Ring', '../shape/Droplet', '../shape/Circle'], function (require) {
        var Base = require('./Base');
        var util = require('../tool/util');
        var zrArea = require('../tool/area');
        var RingShape = require('../shape/Ring');
        var DropletShape = require('../shape/Droplet');
        var CircleShape = require('../shape/Circle');

        function Whirling(options) {
            Base.call(this, options);
        }
        util.inherits(Whirling, Base);

        /**
         * 旋转水滴
         * 
         * @param {Object} addShapeHandle
         * @param {Object} refreshHandle
         */
        Whirling.prototype._start = function (addShapeHandle, refreshHandle) {
            var options = util.merge(
                this.options,
                {
                    textStyle : {
                        color : '#888',
                        textAlign : 'start'
                    },
                    backgroundColor : 'rgba(250, 250, 250, 0.8)'
                }
            );
            var textShape = this.createTextShape(options.textStyle);
            
            var textGap = 10;
            var textWidth = zrArea.getTextWidth(
                textShape.highlightStyle.text, textShape.highlightStyle.textFont
            );
            var textHeight = zrArea.getTextHeight(
                textShape.highlightStyle.text, textShape.highlightStyle.textFont
            );
            
            // 特效默认配置
            var effectOption = util.merge(
                this.options.effect || {},
                {
                    r : 18,
                    colorIn : '#fff',
                    colorOut : '#555',
                    colorWhirl : '#6cf',
                    timeInterval : 50
                }
            );
            
            var location = this.getLocation(
                this.options.textStyle,
                textWidth + textGap + effectOption.r * 2,
                Math.max(effectOption.r * 2, textHeight)
            );
            effectOption.x = location.x + effectOption.r;
            effectOption.y = textShape.highlightStyle.y = location.y + location.height / 2;
            textShape.highlightStyle.x = effectOption.x + effectOption.r + textGap;
            
            var background = this.createBackgroundShape(options.backgroundColor);
            // 初始化动画元素
            var droplet = new DropletShape({
                highlightStyle : {
                    a : Math.round(effectOption.r / 2),
                    b : Math.round(effectOption.r - effectOption.r / 6),
                    brushType : 'fill',
                    color : effectOption.colorWhirl
                }
            });
            var circleIn = new CircleShape({
                highlightStyle : {
                    r : Math.round(effectOption.r / 6),
                    brushType : 'fill',
                    color : effectOption.colorIn
                }
            });
            var circleOut = new RingShape({
                highlightStyle : {
                    r0 : Math.round(effectOption.r - effectOption.r / 3),
                    r : effectOption.r,
                    brushType : 'fill',
                    color : effectOption.colorOut
                }
            });

            var pos = [ 0, effectOption.x, effectOption.y ];

            droplet.highlightStyle.x
                = circleIn.highlightStyle.x
                = circleOut.highlightStyle.x
                = pos[1];
            droplet.highlightStyle.y
                = circleIn.highlightStyle.y
                = circleOut.highlightStyle.y
                = pos[2];

            return setInterval(
                function() {
                    addShapeHandle(background);
                    addShapeHandle(circleOut);
                    pos[0] -= 0.3;
                    droplet.rotation = pos;
                    addShapeHandle(droplet);
                    addShapeHandle(circleIn);
                    addShapeHandle(textShape);
                    refreshHandle();
                },
                effectOption.timeInterval
            );
        };

        return Whirling;
    });
define('echarts/theme/macarons', [], function () {

var theme = {
    // 默认色板
    color: [
        '#2ec7c9','#b6a2de','#5ab1ef','#ffb980','#d87a80',
        '#8d98b3','#e5cf0d','#97b552','#95706d','#dc69aa',
        '#07a2a4','#9a7fd1','#588dd5','#f5994e','#c05050',
        '#59678c','#c9ab00','#7eb00a','#6f5553','#c14089'
    ],

    // 图表标题
    title: {
        textStyle: {
            fontWeight: 'normal',
            color: '#008acd'          // 主标题文字颜色
        }
    },
    
    // 值域
    dataRange: {
        itemWidth: 15,
        color: ['#5ab1ef','#e0ffff']
    },

    // 工具箱
    toolbox: {
        color : ['#1e90ff', '#1e90ff', '#1e90ff', '#1e90ff'],
        effectiveColor : '#ff4500'
    },

    // 提示框
    tooltip: {
        backgroundColor: 'rgba(50,50,50,0.5)',     // 提示背景颜色，默认为透明度为0.7的黑色
        axisPointer : {            // 坐标轴指示器，坐标轴触发有效
            type : 'line',         // 默认为直线，可选为：'line' | 'shadow'
            lineStyle : {          // 直线指示器样式设置
                color: '#008acd'
            },
            crossStyle: {
                color: '#008acd'
            },
            shadowStyle : {                     // 阴影指示器样式设置
                color: 'rgba(200,200,200,0.2)'
            }
        }
    },

    // 区域缩放控制器
    dataZoom: {
        dataBackgroundColor: '#efefff',            // 数据背景颜色
        fillerColor: 'rgba(182,162,222,0.2)',   // 填充颜色
        handleColor: '#008acd'    // 手柄颜色
    },

    // 网格
    grid: {
        borderColor: '#eee'
    },

    // 类目轴
    categoryAxis: {
        axisLine: {            // 坐标轴线
            lineStyle: {       // 属性lineStyle控制线条样式
                color: '#008acd'
            }
        },
        splitLine: {           // 分隔线
            lineStyle: {       // 属性lineStyle（详见lineStyle）控制线条样式
                color: ['#eee']
            }
        }
    },

    // 数值型坐标轴默认参数
    valueAxis: {
        axisLine: {            // 坐标轴线
            lineStyle: {       // 属性lineStyle控制线条样式
                color: '#008acd'
            }
        },
        splitArea : {
            show : true,
            areaStyle : {
                color: ['rgba(250,250,250,0.1)','rgba(200,200,200,0.1)']
            }
        },
        splitLine: {           // 分隔线
            lineStyle: {       // 属性lineStyle（详见lineStyle）控制线条样式
                color: ['#eee']
            }
        }
    },

    polar : {
        axisLine: {            // 坐标轴线
            lineStyle: {       // 属性lineStyle控制线条样式
                color: '#ddd'
            }
        },
        splitArea : {
            show : true,
            areaStyle : {
                color: ['rgba(250,250,250,0.2)','rgba(200,200,200,0.2)']
            }
        },
        splitLine : {
            lineStyle : {
                color : '#ddd'
            }
        }
    },

    timeline : {
        lineStyle : {
            color : '#008acd'
        },
        controlStyle : {
            normal : { color : '#008acd'},
            emphasis : { color : '#008acd'}
        },
        symbol : 'emptyCircle',
        symbolSize : 3
    },

    // 柱形图默认参数
    bar: {
        itemStyle: {
            normal: {
                barBorderRadius: 5
            },
            emphasis: {
                barBorderRadius: 5
            }
        }
    },

    // 折线图默认参数
    line: {
        smooth : true,
        symbol: 'emptyCircle',  // 拐点图形类型
        symbolSize: 3           // 拐点图形大小
    },
    
    // K线图默认参数
    k: {
        itemStyle: {
            normal: {
                color: '#d87a80',       // 阳线填充颜色
                color0: '#2ec7c9',      // 阴线填充颜色
                lineStyle: {
                    color: '#d87a80',   // 阳线边框颜色
                    color0: '#2ec7c9'   // 阴线边框颜色
                }
            }
        }
    },
    
    // 散点图默认参数
    scatter: {
        symbol: 'circle',    // 图形类型
        symbolSize: 4        // 图形大小，半宽（半径）参数，当图形为方向或菱形则总宽度为symbolSize * 2
    },

    // 雷达图默认参数
    radar : {
        symbol: 'emptyCircle',    // 图形类型
        symbolSize:3
        //symbol: null,         // 拐点图形类型
        //symbolRotate : null,  // 图形旋转控制
    },

    map: {
        itemStyle: {
            normal: {
                areaStyle: {
                    color: '#ddd'
                },
                label: {
                    textStyle: {
                        color: '#d87a80'
                    }
                }
            },
            emphasis: {                 // 也是选中样式
                areaStyle: {
                    color: '#fe994e'
                }
            }
        }
    },
    
    force : {
        itemStyle: {
            normal: {
                linkStyle : {
                    color : '#1e90ff'
                }
            }
        }
    },

    chord : {
        itemStyle : {
            normal : {
                borderWidth: 1,
                borderColor: 'rgba(128, 128, 128, 0.5)',
                chordStyle : {
                    lineStyle : {
                        color : 'rgba(128, 128, 128, 0.5)'
                    }
                }
            },
            emphasis : {
                borderWidth: 1,
                borderColor: 'rgba(128, 128, 128, 0.5)',
                chordStyle : {
                    lineStyle : {
                        color : 'rgba(128, 128, 128, 0.5)'
                    }
                }
            }
        }
    },

    gauge : {
        axisLine: {            // 坐标轴线
            lineStyle: {       // 属性lineStyle控制线条样式
                color: [[0.2, '#2ec7c9'],[0.8, '#5ab1ef'],[1, '#d87a80']], 
                width: 10
            }
        },
        axisTick: {            // 坐标轴小标记
            splitNumber: 10,   // 每份split细分多少段
            length :15,        // 属性length控制线长
            lineStyle: {       // 属性lineStyle控制线条样式
                color: 'auto'
            }
        },
        splitLine: {           // 分隔线
            length :22,         // 属性length控制线长
            lineStyle: {       // 属性lineStyle（详见lineStyle）控制线条样式
                color: 'auto'
            }
        },
        pointer : {
            width : 5
        }
    },
    
    textStyle: {
        fontFamily: '微软雅黑, Arial, Verdana, sans-serif'
    }
};

    return theme;
});
define('echarts/chart/base', ['require', 'zrender/shape/Image', '../util/shape/Icon', '../util/shape/MarkLine', '../util/shape/Symbol', 'zrender/shape/Polyline', 'zrender/shape/ShapeBundle', '../config', '../util/ecData', '../util/ecAnimation', '../util/ecEffect', '../util/accMath', '../component/base', '../layout/EdgeBundling', 'zrender/tool/util', 'zrender/tool/area'], function (require) {
    // 图形依赖
    var ImageShape = require('zrender/shape/Image');
    var IconShape = require('../util/shape/Icon');
    var MarkLineShape = require('../util/shape/MarkLine');
    var SymbolShape = require('../util/shape/Symbol');
    var PolylineShape = require('zrender/shape/Polyline');
    var ShapeBundle = require('zrender/shape/ShapeBundle');
    
    var ecConfig = require('../config');
    var ecData = require('../util/ecData');
    var ecAnimation = require('../util/ecAnimation');
    var ecEffect = require('../util/ecEffect');
    var accMath = require('../util/accMath');
    var ComponentBase = require('../component/base');
    var EdgeBundling = require('../layout/EdgeBundling');

    var zrUtil = require('zrender/tool/util');
    var zrArea = require('zrender/tool/area');

    // Some utility functions
    function isCoordAvailable(coord) {
        return coord.x != null && coord.y != null;
    }
    
    function Base(ecTheme, messageCenter, zr, option, myChart) {

        ComponentBase.call(this, ecTheme, messageCenter, zr, option, myChart);

        var self = this;
        this.selectedMap = {};
        this.lastShapeList = [];
        this.shapeHandler = {
            onclick: function () {
                self.isClick = true;
            },
            
            ondragover: function (param) {
                // 返回触发可计算特性的图形提示
                var calculableShape = param.target;
                calculableShape.highlightStyle = calculableShape.highlightStyle || {};
                
                // 备份特出特性
                var highlightStyle = calculableShape.highlightStyle;
                var brushType = highlightStyle.brushTyep;
                var strokeColor = highlightStyle.strokeColor;
                var lineWidth = highlightStyle.lineWidth;
                
                highlightStyle.brushType = 'stroke';
                highlightStyle.strokeColor = self.ecTheme.calculableColor
                                             || ecConfig.calculableColor;
                highlightStyle.lineWidth = calculableShape.type === 'icon' ? 30 : 10;

                self.zr.addHoverShape(calculableShape);
                
                setTimeout(function (){
                    // 复位
                    if (highlightStyle) {
                        highlightStyle.brushType = brushType;
                        highlightStyle.strokeColor = strokeColor;
                        highlightStyle.lineWidth = lineWidth;
                    }
                },20);
            },
            
            ondrop: function (param) {
                // 排除一些非数据的拖拽进入
                if (ecData.get(param.dragged, 'data') != null) {
                    self.isDrop = true;
                }
            },
            
            ondragend: function () {
                self.isDragend = true;
            }
        };
    }
    
    /**
     * 基类方法
     */
    Base.prototype = {
        /**
         * 图形拖拽特性 
         */
        setCalculable: function (shape) {
            shape.dragEnableTime = this.ecTheme.DRAG_ENABLE_TIME || ecConfig.DRAG_ENABLE_TIME;
            shape.ondragover = this.shapeHandler.ondragover;
            shape.ondragend = this.shapeHandler.ondragend;
            shape.ondrop = this.shapeHandler.ondrop;
            return shape;
        },

        /**
         * 数据项被拖拽进来
         */
        ondrop: function (param, status) {
            if (!this.isDrop || !param.target || status.dragIn) {
                // 没有在当前实例上发生拖拽行为或者已经被认领了则直接返回
                return;
            }
            var target = param.target;      // 拖拽安放目标
            var dragged = param.dragged;    // 当前被拖拽的图形对象

            var seriesIndex = ecData.get(target, 'seriesIndex');
            var dataIndex = ecData.get(target, 'dataIndex');

            var series = this.series;
            var data;
            var legend = this.component.legend;
            if (dataIndex === -1) {
                // 落到calculableCase上，数据被拖拽进某个饼图|雷达|漏斗，增加数据
                if (ecData.get(dragged, 'seriesIndex') == seriesIndex) {
                    // 自己拖拽到自己
                    status.dragOut = status.dragIn = status.needRefresh = true;
                    this.isDrop = false;
                    return;
                }
                
                data = {
                    value: ecData.get(dragged, 'value'),
                    name: ecData.get(dragged, 'name')
                };

                // 修饼图数值不为负值
                if (this.type === ecConfig.CHART_TYPE_PIE && data.value < 0) {
                    data.value = 0;
                }

                var hasFind = false;
                var sData = series[seriesIndex].data;
                for (var i = 0, l = sData.length; i < l; i++) {
                    if (sData[i].name === data.name && sData[i].value === '-') {
                        series[seriesIndex].data[i].value = data.value;
                        hasFind = true;
                    }
                }
                !hasFind && series[seriesIndex].data.push(data);

                legend && legend.add(
                    data.name,
                    dragged.style.color || dragged.style.strokeColor
                );
            }
            else {
                // 落到数据item上，数据被拖拽到某个数据项上，数据修改
                data = series[seriesIndex].data[dataIndex] || '-';
                if (data.value != null) {
                    if (data.value != '-') {
                        series[seriesIndex].data[dataIndex].value = 
                            accMath.accAdd(
                                series[seriesIndex].data[dataIndex].value,
                                ecData.get(dragged, 'value')
                            );
                    }
                    else {
                        series[seriesIndex].data[dataIndex].value =
                            ecData.get(dragged, 'value');
                    }
                    
                    if (this.type === ecConfig.CHART_TYPE_FUNNEL
                        || this.type === ecConfig.CHART_TYPE_PIE
                    ) {
                        legend && legend.getRelatedAmount(data.name) === 1 
                               && this.component.legend.del(data.name);
                        data.name += this.option.nameConnector + ecData.get(dragged, 'name');
                        legend && legend.add(
                            data.name,
                            dragged.style.color || dragged.style.strokeColor
                        );
                    }
                }
                else {
                    if (data != '-') {
                        series[seriesIndex].data[dataIndex] = 
                            accMath.accAdd(
                                series[seriesIndex].data[dataIndex],
                                ecData.get(dragged, 'value')
                            );
                    }
                    else {
                        series[seriesIndex].data[dataIndex] =
                            ecData.get(dragged, 'value');
                    }
                }
            }

            // 别status = {}赋值啊！！
            status.dragIn = status.dragIn || true;

            // 处理完拖拽事件后复位
            this.isDrop = false;

            var self = this;
            setTimeout(function(){
                self.zr.trigger('mousemove', param.event);
            }, 300);
            
            return;
        },

        /**
         * 数据项被拖拽出去
         */
        ondragend: function (param, status) {
            if (!this.isDragend || !param.target || status.dragOut) {
                // 没有在当前实例上发生拖拽行为或者已经被认领了则直接返回
                return;
            }
            var target = param.target;      // 被拖拽图形元素

            var seriesIndex = ecData.get(target, 'seriesIndex');
            var dataIndex = ecData.get(target, 'dataIndex');

            var series = this.series;

            // 删除被拖拽走的数据
            if (series[seriesIndex].data[dataIndex].value != null) {
                series[seriesIndex].data[dataIndex].value = '-';
                // 清理可能有且唯一的legend data
                var name = series[seriesIndex].data[dataIndex].name;
                var legend = this.component.legend;
                if (legend && legend.getRelatedAmount(name) === 0) {
                    legend.del(name);
                }
            }
            else {
                series[seriesIndex].data[dataIndex] = '-';
            }
            
            // 别status = {}赋值啊！！
            status.dragOut = true;
            status.needRefresh = true;

            // 处理完拖拽事件后复位
            this.isDragend = false;

            return;
        },

        /**
         * 图例选择
         */
        onlegendSelected: function (param, status) {
            var legendSelected = param.selected;
            for (var itemName in this.selectedMap) {
                if (this.selectedMap[itemName] != legendSelected[itemName]) {
                    // 有一项不一致都需要重绘
                    status.needRefresh = true;
                }
                this.selectedMap[itemName] = legendSelected[itemName];
            }
            return;
        },
        
        /**
         * 折线图、柱形图公用方法
         */
        _buildPosition: function() {
            this._symbol = this.option.symbolList;
            this._sIndex2ShapeMap = {};  // series拐点图形类型，seriesIndex索引到shape type
            this._sIndex2ColorMap = {};  // series默认颜色索引，seriesIndex索引到color

            this.selectedMap = {};
            this.xMarkMap = {};
            
            var series = this.series;
            // 水平垂直双向series索引 ，position索引到seriesIndex
            var _position2sIndexMap = {
                top: [],
                bottom: [],
                left: [],
                right: [],
                other: []
            };
            var xAxisIndex;
            var yAxisIndex;
            var xAxis;
            var yAxis;
            for (var i = 0, l = series.length; i < l; i++) {
                if (series[i].type === this.type) {
                    series[i] = this.reformOption(series[i]);
                    this.legendHoverLink = series[i].legendHoverLink || this.legendHoverLink;
                    xAxisIndex = series[i].xAxisIndex;
                    yAxisIndex = series[i].yAxisIndex;
                    xAxis = this.component.xAxis.getAxis(xAxisIndex);
                    yAxis = this.component.yAxis.getAxis(yAxisIndex);
                    if (xAxis.type === ecConfig.COMPONENT_TYPE_AXIS_CATEGORY) {
                        _position2sIndexMap[xAxis.getPosition()].push(i);
                    }
                    else if (yAxis.type === ecConfig.COMPONENT_TYPE_AXIS_CATEGORY) {
                        _position2sIndexMap[yAxis.getPosition()].push(i);
                    }
                    else {
                        _position2sIndexMap.other.push(i);
                    }
                }
            }
            // console.log(_position2sIndexMap);
            for (var position in _position2sIndexMap) {
                if (_position2sIndexMap[position].length > 0) {
                    this._buildSinglePosition(
                        position, _position2sIndexMap[position]
                    );
                }
            }

            this.addShapeList();
        },
        
        /**
         * 构建单个方向上的折线图、柱形图公用方法
         *
         * @param {number} seriesIndex 系列索引
         */
        _buildSinglePosition: function (position, seriesArray) {
            var mapData = this._mapData(seriesArray);
            var locationMap = mapData.locationMap;
            var maxDataLength = mapData.maxDataLength;

            if (maxDataLength === 0 || locationMap.length === 0) {
                return;
            }
            switch (position) {
                case 'bottom' :
                case 'top' :
                    this._buildHorizontal(seriesArray, maxDataLength, locationMap, this.xMarkMap);
                    break;
                case 'left' :
                case 'right' :
                    this._buildVertical(seriesArray, maxDataLength, locationMap, this.xMarkMap);
                    break;
                case 'other' :
                    this._buildOther(seriesArray, maxDataLength, locationMap, this.xMarkMap);
                    break;
            }
            
            for (var i = 0, l = seriesArray.length; i < l; i++) {
                this.buildMark(seriesArray[i]);
            }
        },
        
        /**
         * 数据整形，折线图、柱形图公用方法
         * 数组位置映射到系列索引
         */
        _mapData: function (seriesArray) {
            var series = this.series;
            var serie;                              // 临时映射变量
            var dataIndex = 0;                      // 堆积数据所在位置映射
            var stackMap = {};                      // 堆积数据位置映射，堆积组在二维中的第几项
            var magicStackKey = '__kener__stack__'; // 堆积命名，非堆积数据安单一堆积处理
            var stackKey;                           // 临时映射变量
            var serieName;                          // 临时映射变量
            var legend = this.component.legend;
            var locationMap = [];                   // 需要返回的东西：数组位置映射到系列索引
            var maxDataLength = 0;                  // 需要返回的东西：最大数据长度
            var iconShape;
            // 计算需要显示的个数和分配位置并记在下面这个结构里
            for (var i = 0, l = seriesArray.length; i < l; i++) {
                serie = series[seriesArray[i]];
                serieName = serie.name;
                
                this._sIndex2ShapeMap[seriesArray[i]] = this._sIndex2ShapeMap[seriesArray[i]]
                                                        || this.query(serie,'symbol')
                                                        || this._symbol[i % this._symbol.length];
                      
                if (legend){
                    this.selectedMap[serieName] = legend.isSelected(serieName);
                    
                    this._sIndex2ColorMap[seriesArray[i]] = legend.getColor(serieName);
                        
                    iconShape = legend.getItemShape(serieName);
                    if (iconShape) {
                        // 回调legend，换一个更形象的icon
                        var style = iconShape.style;
                        if (this.type == ecConfig.CHART_TYPE_LINE) {
                            style.iconType = 'legendLineIcon';
                            style.symbol =  this._sIndex2ShapeMap[seriesArray[i]];
                        }
                        else if (serie.itemStyle.normal.barBorderWidth > 0) {
                            var highlightStyle = iconShape.highlightStyle;
                            style.brushType = 'both';
                            style.x += 1;
                            style.y += 1;
                            style.width -= 2;
                            style.height -= 2;
                            style.strokeColor 
                                = highlightStyle.strokeColor 
                                = serie.itemStyle.normal.barBorderColor;
                            highlightStyle.lineWidth = 3;
                        }
                        
                        legend.setItemShape(serieName, iconShape);
                    }
                }
                else {
                    this.selectedMap[serieName] = true;
                    this._sIndex2ColorMap[seriesArray[i]] = this.zr.getColor(seriesArray[i]);
                }

                if (this.selectedMap[serieName]) {
                    stackKey = serie.stack || (magicStackKey + seriesArray[i]);
                    if (stackMap[stackKey] == null) {
                        stackMap[stackKey] = dataIndex;
                        locationMap[dataIndex] = [seriesArray[i]];
                        dataIndex++;
                    }
                    else {
                        // 已经分配了位置就推进去就行
                        locationMap[stackMap[stackKey]].push(seriesArray[i]);
                    }
                }
                // 兼职帮算一下最大长度
                maxDataLength = Math.max(maxDataLength, serie.data.length);
            }
            /* 调试输出
            var s = '';
            for (var i = 0, l = maxDataLength; i < l; i++) {
                s = '[';
                for (var j = 0, k = locationMap.length; j < k; j++) {
                    s +='['
                    for (var m = 0, n = locationMap[j].length - 1; m < n; m++) {
                        s += series[locationMap[j][m]].data[i] + ','
                    }
                    s += series[locationMap[j][locationMap[j].length - 1]]
                         .data[i];
                    s += ']'
                }
                s += ']';
                console.log(s);
            }
            console.log(locationMap)
            */

            return {
                locationMap: locationMap,
                maxDataLength: maxDataLength
            };
        },
        
        _calculMarkMapXY : function(xMarkMap, locationMap, xy) {
            var series = this.series;
            for (var j = 0, k = locationMap.length; j < k; j++) {
                for (var m = 0, n = locationMap[j].length; m < n; m++) {
                    var seriesIndex = locationMap[j][m];
                    var valueIndex = xy == 'xy' ? 0 : '';
                    var grid = this.component.grid;
                    var tarMark = xMarkMap[seriesIndex];

                    if (xy.indexOf('x') != '-1') {
                        if (tarMark['counter' + valueIndex] > 0) {
                            tarMark['average' + valueIndex] =
                                tarMark['sum' + valueIndex] / tarMark['counter' + valueIndex];
                        }
                        
                        var x = this.component.xAxis.getAxis(series[seriesIndex].xAxisIndex || 0)
                                .getCoord(tarMark['average' + valueIndex]);
                        tarMark['averageLine' + valueIndex] = [
                            [x, grid.getYend()],
                            [x, grid.getY()]
                        ];
                        tarMark['minLine' + valueIndex] = [
                            [tarMark['minX' + valueIndex], grid.getYend()],
                            [tarMark['minX' + valueIndex], grid.getY()]
                        ];
                        tarMark['maxLine' + valueIndex] = [
                            [tarMark['maxX' + valueIndex], grid.getYend()],
                            [tarMark['maxX' + valueIndex], grid.getY()]
                        ];
                        
                        tarMark.isHorizontal = false;
                    }
                    
                    valueIndex = xy == 'xy' ? 1 : '';
                    if (xy.indexOf('y') != '-1') {
                        if (tarMark['counter' + valueIndex] > 0) {
                            tarMark['average' + valueIndex] = 
                                tarMark['sum' + valueIndex] / tarMark['counter' + valueIndex];
                        }
                        var y = this.component.yAxis.getAxis(series[seriesIndex].yAxisIndex || 0)
                                .getCoord(tarMark['average' + valueIndex]);
                        tarMark['averageLine' + valueIndex] = [
                            [grid.getX(), y],
                            [grid.getXend(), y]
                        ];
                        tarMark['minLine' + valueIndex] = [
                            [grid.getX(), tarMark['minY' + valueIndex]],
                            [grid.getXend(), tarMark['minY' + valueIndex]]
                        ];
                        tarMark['maxLine' + valueIndex] = [
                            [grid.getX(), tarMark['maxY' + valueIndex]],
                            [grid.getXend(), tarMark['maxY' + valueIndex]]
                        ];
                        
                        tarMark.isHorizontal = true;
                    }
                }
            }
        },
        
        /**
         * 添加文本 
         */
        addLabel: function (tarShape, serie, data, name, orient) {
            // 多级控制
            var queryTarget = [data, serie];
            var nLabel = this.deepMerge(queryTarget, 'itemStyle.normal.label');
            var eLabel = this.deepMerge(queryTarget, 'itemStyle.emphasis.label');

            var nTextStyle = nLabel.textStyle || {};
            var eTextStyle = eLabel.textStyle || {};
            
            if (nLabel.show) {
                var style = tarShape.style;
                style.text = this._getLabelText(
                    serie, data, name, 'normal'
                );
                style.textPosition = nLabel.position == null
                                     ? (orient === 'horizontal' ? 'right' : 'top')
                                     : nLabel.position;
                style.textColor = nTextStyle.color;
                style.textFont = this.getFont(nTextStyle);
                style.textAlign = nTextStyle.align;
                style.textBaseline = nTextStyle.baseline;
            }
            if (eLabel.show) {
                var highlightStyle = tarShape.highlightStyle;
                highlightStyle.text = this._getLabelText(
                    serie, data, name, 'emphasis'
                );
                highlightStyle.textPosition = nLabel.show
                                              ? tarShape.style.textPosition
                                              : (eLabel.position == null
                                                 ? (orient === 'horizontal' ? 'right' : 'top')
                                                 : eLabel.position);
                highlightStyle.textColor = eTextStyle.color;
                highlightStyle.textFont = this.getFont(eTextStyle);
                highlightStyle.textAlign = eTextStyle.align;
                highlightStyle.textBaseline = eTextStyle.baseline;
            }
            
            return tarShape;
        },
        
        /**
         * 根据lable.format计算label text
         */
        _getLabelText: function (serie, data, name, status) {
            var formatter = this.deepQuery(
                [data, serie],
                'itemStyle.' + status + '.label.formatter'
            );
            if (!formatter && status === 'emphasis') {
                // emphasis时需要看看normal下是否有formatter
                formatter = this.deepQuery(
                    [data, serie],
                    'itemStyle.normal.label.formatter'
                );
            }
            
            var value = this.getDataFromOption(data, '-');
            
            if (formatter) {
                if (typeof formatter === 'function') {
                    return formatter.call(
                        this.myChart,
                        {
                            seriesName: serie.name,
                            series: serie,
                            name: name,
                            value: value,
                            data: data,
                            status: status
                        }
                    );
                }
                else if (typeof formatter === 'string') {
                    formatter = formatter.replace('{a}','{a0}')
                                         .replace('{b}','{b0}')
                                         .replace('{c}','{c0}')
                                         .replace('{a0}', serie.name)
                                         .replace('{b0}', name)
                                         .replace('{c0}', this.numAddCommas(value));
    
                    return formatter;
                }
            }
            else {
                if (value instanceof Array) {
                    return value[2] != null
                           ? this.numAddCommas(value[2])
                           : (value[0] + ' , ' + value[1]);
                }
                else {
                    return this.numAddCommas(value);
                }
            }
        },
        
        /**
         * 标线标注 
         */
        buildMark: function (seriesIndex) {
            var serie = this.series[seriesIndex];
            if (this.selectedMap[serie.name]) {
                serie.markLine && this._buildMarkLine(seriesIndex);
                serie.markPoint && this._buildMarkPoint(seriesIndex);
            }
        },
        
        /**
         * 标注逻辑
         */
        _buildMarkPoint: function (seriesIndex) {
            var attachStyle =  (this.markAttachStyle || {})[seriesIndex];
            var serie = this.series[seriesIndex];
            var mpData;
            var pos;
            var markPoint = zrUtil.clone(serie.markPoint);
            for (var i = 0, l = markPoint.data.length; i < l; i++) {
                mpData = markPoint.data[i];
                pos = this.getMarkCoord(seriesIndex, mpData);
                mpData.x = mpData.x != null ? mpData.x : pos[0];
                mpData.y = mpData.y != null ? mpData.y : pos[1];
                if (mpData.type
                    && (mpData.type === 'max' || mpData.type === 'min')
                ) {
                    // 特殊值内置支持
                    mpData.value = pos[3];
                    mpData.name = mpData.name || mpData.type;
                    mpData.symbolSize = mpData.symbolSize
                        || (zrArea.getTextWidth(pos[3], this.getFont()) / 2 + 5);
                }
            }
            
            var shapeList = this._markPoint(seriesIndex, markPoint);
            
            for (var i = 0, l = shapeList.length; i < l; i++) {
                var tarShape = shapeList[i];
                tarShape.zlevel = serie.zlevel;
                tarShape.z = serie.z + 1;
                for (var key in attachStyle) {
                    tarShape[key] = zrUtil.clone(attachStyle[key]);
                }
                this.shapeList.push(tarShape);
            }
            // 个别特殊图表需要自己addShape
            if (this.type === ecConfig.CHART_TYPE_FORCE
                || this.type === ecConfig.CHART_TYPE_CHORD
            ) {
                for (var i = 0, l = shapeList.length; i < l; i++) {
                    this.zr.addShape(shapeList[i]);
                }
            }
        },
        
        /**
         * 标线逻辑
         */
        _buildMarkLine: function (seriesIndex) {
            var attachStyle =  (this.markAttachStyle || {})[seriesIndex];
            var serie = this.series[seriesIndex];
            var pos;
            var markLine = zrUtil.clone(serie.markLine);
            for (var i = 0, l = markLine.data.length; i < l; i++) {
                var mlData = markLine.data[i];
                if (mlData.type
                    && (mlData.type === 'max' || mlData.type === 'min' || mlData.type === 'average')
                ) {
                    // 特殊值内置支持
                    pos = this.getMarkCoord(seriesIndex, mlData);
                    markLine.data[i] = [zrUtil.clone(mlData), {}];
                    markLine.data[i][0].name = mlData.name || mlData.type;
                    markLine.data[i][0].value = mlData.type !== 'average'
                                                ? pos[3]
                                                : +pos[3].toFixed(
                                                      markLine.precision != null 
                                                      ? markLine.precision 
                                                      : this.deepQuery(
                                                            [this.ecTheme, ecConfig],
                                                            'markLine.precision'
                                                        )
                                                  );
                    pos = pos[2];
                    mlData = [{},{}];
                }
                else {
                    pos = [
                        this.getMarkCoord(seriesIndex, mlData[0]),
                        this.getMarkCoord(seriesIndex, mlData[1])
                    ];
                }
                if (pos == null || pos[0] == null || pos[1] == null) {
                    // 不在显示区域内
                    continue;
                }
                markLine.data[i][0].x = mlData[0].x != null ? mlData[0].x : pos[0][0];
                markLine.data[i][0].y = mlData[0].y != null ? mlData[0].y : pos[0][1];
                markLine.data[i][1].x = mlData[1].x != null ? mlData[1].x : pos[1][0];
                markLine.data[i][1].y = mlData[1].y != null ? mlData[1].y : pos[1][1];
            }
            
            var shapeList = this._markLine(seriesIndex, markLine);

            var isLarge = markLine.large;

            if (isLarge) {
                var shapeBundle = new ShapeBundle({
                    style: {
                        shapeList: shapeList
                    }
                });
                var firstShape = shapeList[0];
                if (firstShape) {
                    zrUtil.merge(shapeBundle.style, firstShape.style);
                    zrUtil.merge(shapeBundle.highlightStyle = {}, firstShape.highlightStyle);
                    shapeBundle.style.brushType = 'stroke';
                    shapeBundle.zlevel = serie.zlevel;
                    shapeBundle.z = serie.z + 1;
                    shapeBundle.hoverable = false;
                    for (var key in attachStyle) {
                        shapeBundle[key] = zrUtil.clone(attachStyle[key]);
                    }
                }
                this.shapeList.push(shapeBundle);
                this.zr.addShape(shapeBundle);

                shapeBundle._mark = 'largeLine';
                var effect = markLine.effect;
                if (effect.show) {
                    shapeBundle.effect = effect;
                }
            }
            else {
                for (var i = 0, l = shapeList.length; i < l; i++) {
                    var tarShape = shapeList[i];
                    tarShape.zlevel = serie.zlevel;
                    tarShape.z = serie.z + 1;
                    for (var key in attachStyle) {
                        tarShape[key] = zrUtil.clone(attachStyle[key]);
                    }
                    this.shapeList.push(tarShape);
                }
                // 个别特殊图表需要自己addShape
                if (this.type === ecConfig.CHART_TYPE_FORCE
                    || this.type === ecConfig.CHART_TYPE_CHORD
                ) {
                    for (var i = 0, l = shapeList.length; i < l; i++) {
                        this.zr.addShape(shapeList[i]);
                    }
                }
            }
        },
        
        /**
         * 标注多级控制构造
         */
        _markPoint: function (seriesIndex, mpOption) {
            var serie = this.series[seriesIndex];
            var component = this.component;
            zrUtil.merge(
                zrUtil.merge(
                    mpOption,
                    zrUtil.clone(this.ecTheme.markPoint || {})
                ),
                zrUtil.clone(ecConfig.markPoint)
            );

            mpOption.name = serie.name;
                   
            var pList = [];
            var data = mpOption.data;
            var itemShape;
            
            var dataRange = component.dataRange;
            var legend = component.legend;
            var color;
            var value;
            var queryTarget;
            var nColor;
            var eColor;
            var effect;
            var zrWidth = this.zr.getWidth();
            var zrHeight = this.zr.getHeight();

            if (!mpOption.large) {
                for (var i = 0, l = data.length; i < l; i++) {
                    if (data[i].x == null || data[i].y == null) {
                        continue;
                    }
                    value = data[i].value != null ? data[i].value : '';
                    // 图例
                    if (legend) {
                        color = legend.getColor(serie.name);
                    }
                    // 值域
                    if (dataRange) {
                        color = isNaN(value) ? color : dataRange.getColor(value);
                        
                        queryTarget = [data[i], mpOption];
                        nColor = this.deepQuery(queryTarget, 'itemStyle.normal.color')
                                 || color;
                        eColor = this.deepQuery(queryTarget, 'itemStyle.emphasis.color')
                                 || nColor;
                        // 有值域，并且值域返回null且用户没有自己定义颜色，则隐藏这个mark
                        if (nColor == null && eColor == null) {
                            continue;
                        }
                    }
                    
                    color = color == null ? this.zr.getColor(seriesIndex) : color;
                    
                    // 标准化一些参数
                    data[i].tooltip = data[i].tooltip
                                      || mpOption.tooltip
                                      || {trigger:'item'}; // tooltip.trigger指定为item
                    data[i].name = data[i].name != null ? data[i].name : '';
                    data[i].value = value;

                    // 复用getSymbolShape
                    itemShape = this.getSymbolShape(
                        mpOption, seriesIndex,      // 系列 
                        data[i], i, data[i].name,   // 数据
                        this.parsePercent(data[i].x, zrWidth),   // 坐标
                        this.parsePercent(data[i].y, zrHeight),  // 坐标
                        'pin', color,               // 默认symbol和color
                        'rgba(0,0,0,0)',
                        'horizontal'                // 走向，用于默认文字定位
                    );
                    itemShape._mark = 'point';
                    
                    effect = this.deepMerge(
                        [data[i], mpOption],
                        'effect'
                    );
                    if (effect.show) {
                        itemShape.effect = effect;
                    }
                    
                    if (serie.type === ecConfig.CHART_TYPE_MAP) {
                        itemShape._geo = this.getMarkGeo(data[i]);
                    }
                    
                    // 重新pack一下数据
                    ecData.pack(
                        itemShape,
                        serie, seriesIndex,
                        data[i], i,
                        data[i].name,
                        value
                    );
                    pList.push(itemShape);
                }
            }
            else {
                // 大规模MarkPoint
                itemShape = this.getLargeMarkPointShape(seriesIndex, mpOption);
                itemShape._mark = 'largePoint';
                itemShape && pList.push(itemShape);
            }
            return pList;
        },
        
        /**
         * 标线多级控制构造
         */
        _markLine: (function () {
            function normalizeOptionValue(mlOption, key) {
                mlOption[key] = mlOption[key] instanceof Array
                          ? mlOption[key].length > 1 
                            ? mlOption[key] 
                            : [mlOption[key][0], mlOption[key][0]]
                          : [mlOption[key], mlOption[key]];
            }

            return function (seriesIndex, mlOption) {
                var serie = this.series[seriesIndex];
                var component = this.component;
                var dataRange = component.dataRange;
                var legend = component.legend;

                zrUtil.merge(
                    zrUtil.merge(
                        mlOption,
                        zrUtil.clone(this.ecTheme.markLine || {})
                    ),
                    zrUtil.clone(ecConfig.markLine)
                );

                var defaultColor = legend ? legend.getColor(serie.name)
                    : this.zr.getColor(seriesIndex);

                // 标准化一些同时支持Array和String的参数
                normalizeOptionValue(mlOption, 'symbol');
                normalizeOptionValue(mlOption, 'symbolSize');
                normalizeOptionValue(mlOption, 'symbolRotate');

                // Normalize and filter data
                var data = mlOption.data;
                var edges = [];
                var zrWidth = this.zr.getWidth();
                var zrHeight = this.zr.getHeight();
                for (var i = 0; i < data.length; i++) {
                    var mlData = data[i];
                    if (isCoordAvailable(mlData[0])
                        && isCoordAvailable(mlData[1])
                    ) {
                        // 组装一个mergeData
                        var mergeData = this.deepMerge(mlData);
                        var queryTarget = [mergeData, mlOption];
                        var color = defaultColor;
                        var value = mergeData.value != null ? mergeData.value : '';
                        // 值域
                        if (dataRange) {
                            color = isNaN(value) ? color : dataRange.getColor(value);

                            var nColor = this.deepQuery(queryTarget, 'itemStyle.normal.color')
                                     || color;
                            var eColor = this.deepQuery(queryTarget, 'itemStyle.emphasis.color')
                                     || nColor;
                            // 有值域，并且值域返回null且用户没有自己定义颜色，则隐藏这个mark
                            if (nColor == null && eColor == null) {
                                continue;
                            }
                        }
                        // 标准化一些参数
                        mlData[0].tooltip = mergeData.tooltip
                                            || mlOption.tooltip
                                            || {trigger:'item'}; // tooltip.trigger指定为item
                        mlData[0].name = mlData[0].name || '';
                        mlData[1].name = mlData[1].name || '';
                        mlData[0].value = value;

                        edges.push({
                            points: [
                                [this.parsePercent(mlData[0].x, zrWidth),
                                this.parsePercent(mlData[0].y, zrHeight)],
                                [this.parsePercent(mlData[1].x, zrWidth),
                                this.parsePercent(mlData[1].y, zrHeight)]
                            ],
                            rawData: mlData,
                            color: color
                        });
                    }
                }

                var enableBundling = this.query(mlOption, 'bundling.enable');
                if (enableBundling) {
                    var edgeBundling = new EdgeBundling();
                    edgeBundling.maxTurningAngle = this.query(
                        mlOption, 'bundling.maxTurningAngle'
                    ) / 180 * Math.PI;
                    edges = edgeBundling.run(edges);
                }

                mlOption.name = serie.name;
  
                var shapeList = [];

                for (var i = 0, l = edges.length; i < l; i++) {
                    var edge = edges[i];
                    var rawEdge = edge.rawEdge || edge; 
                    var mlData = rawEdge.rawData;
                    var value = mlData.value != null ? mlData.value : '';

                    var itemShape = this.getMarkLineShape(
                        mlOption,
                        seriesIndex,
                        mlData,
                        i,
                        edge.points,
                        enableBundling,
                        rawEdge.color
                    );
                    itemShape._mark = 'line';
                    
                    var effect = this.deepMerge(
                        [mlData[0], mlData[1], mlOption],
                        'effect'
                    );
                    if (effect.show) {
                        itemShape.effect = effect;
                        itemShape.effect.large = mlOption.large;
                    }
                    
                    if (serie.type === ecConfig.CHART_TYPE_MAP) {
                        itemShape._geo = [
                            this.getMarkGeo(mlData[0]),
                            this.getMarkGeo(mlData[1])
                        ];
                    }
                    
                    // 重新pack一下数据
                    ecData.pack(
                        itemShape,
                        serie, seriesIndex,
                        mlData[0], i,
                        mlData[0].name 
                            // 不要帮我代码规范
                            + (mlData[1].name !== '' ? (' > ' + mlData[1].name) : ''),
                        value
                    );
                    shapeList.push(itemShape);
                }

                return shapeList;
            };
        })(),
        
        getMarkCoord: function () {
            // 无转换位置
            return [0, 0];
        },
        
        /**
         * symbol构造器 
         */
        getSymbolShape: function (
            serie, seriesIndex,     // 系列 
            data, dataIndex, name,  // 数据
            x, y,                   // 坐标
            symbol, color,          // 默认symbol和color，来自legend或dataRange全局分配
            emptyColor,             // 折线的emptySymbol用白色填充
            orient                  // 走向，用于默认文字定位
        ) {
            var queryTarget = [data, serie];
            var value = this.getDataFromOption(data, '-');
            
            symbol = this.deepQuery(queryTarget, 'symbol') || symbol;
            var symbolSize = this.deepQuery(queryTarget, 'symbolSize');
            symbolSize = typeof symbolSize === 'function'
                         ? symbolSize(value)
                         : symbolSize;
            if (typeof symbolSize === 'number') {
                symbolSize = [symbolSize, symbolSize];
            }
            var symbolRotate = this.deepQuery(queryTarget, 'symbolRotate');
            
            var normal = this.deepMerge(
                queryTarget,
                'itemStyle.normal'
            );
            var emphasis = this.deepMerge(
                queryTarget,
                'itemStyle.emphasis'
            );
            var nBorderWidth = normal.borderWidth != null
                               ? normal.borderWidth
                               : (normal.lineStyle && normal.lineStyle.width);
            if (nBorderWidth == null) {
                nBorderWidth = symbol.match('empty') ? 2 : 0;
            }
            var eBorderWidth = emphasis.borderWidth != null
                               ? emphasis.borderWidth
                               : (emphasis.lineStyle && emphasis.lineStyle.width);
            if (eBorderWidth == null) {
                eBorderWidth = nBorderWidth + 2;
            }

            var nColor = this.getItemStyleColor(normal.color, seriesIndex, dataIndex, data);
            var eColor = this.getItemStyleColor(emphasis.color, seriesIndex, dataIndex, data);
            
            var width = symbolSize[0];
            var height = symbolSize[1];
            var itemShape = new IconShape({
                style: {
                    iconType: symbol.replace('empty', '').toLowerCase(),
                    x: x - width,
                    y: y - height,
                    width: width * 2,
                    height: height * 2,
                    brushType: 'both',
                    color: symbol.match('empty') 
                           ? emptyColor 
                           : (nColor || color),
                    strokeColor: normal.borderColor || nColor || color,
                    lineWidth: nBorderWidth
                },
                highlightStyle: {
                    color: symbol.match('empty') 
                           ? emptyColor 
                           : (eColor || nColor || color),
                    strokeColor: emphasis.borderColor 
                                 || normal.borderColor
                                 || eColor
                                 || nColor
                                 || color,
                    lineWidth: eBorderWidth
                },
                clickable: this.deepQuery(queryTarget, 'clickable')
            });

            if (symbol.match('image')) {
                itemShape.style.image = symbol.replace(new RegExp('^image:\\/\\/'), '');
                itemShape = new ImageShape({
                    style: itemShape.style,
                    highlightStyle: itemShape.highlightStyle,
                    clickable: this.deepQuery(queryTarget, 'clickable')
                });
            }
            
            if (symbolRotate != null) {
                itemShape.rotation = [
                    symbolRotate * Math.PI / 180, x, y
                ];
            }
            
            if (symbol.match('star')) {
                itemShape.style.iconType = 'star';
                itemShape.style.n = 
                    (symbol.replace('empty', '').replace('star','') - 0) || 5;
            }
            
            if (symbol === 'none') {
                itemShape.invisible = true;
                itemShape.hoverable = false;
            }
            
            /*
            if (this.deepQuery([data, serie, option], 'calculable')) {
                this.setCalculable(itemShape);
                itemShape.draggable = true;
            }
            */

            itemShape = this.addLabel(
                itemShape, 
                serie, data, name, 
                orient
            );
            
            if (symbol.match('empty')) {
                if (itemShape.style.textColor == null) {
                    itemShape.style.textColor = itemShape.style.strokeColor;
                }
                if (itemShape.highlightStyle.textColor == null) {
                    itemShape.highlightStyle.textColor = 
                        itemShape.highlightStyle.strokeColor;
                }
            }
            
            ecData.pack(
                itemShape,
                serie, seriesIndex,
                data, dataIndex,
                name
            );

            itemShape._x = x;
            itemShape._y = y;
            
            itemShape._dataIndex = dataIndex;
            itemShape._seriesIndex = seriesIndex;

            return itemShape;
        },
        
        /**
         * 标线构造器 
         */
        getMarkLineShape: function (
            mlOption,               // 系列 
            seriesIndex,            // 系列索引
            data,                   // 数据
            dataIndex,              // 数据索引
            points,                 // 坐标点
            bundling,               // 是否边捆绑过
            color                   // 默认color，来自legend或dataRange全局分配
        ) {
            var value0 = data[0].value != null ? data[0].value : '-';
            var value1 = data[1].value != null ? data[1].value : '-';
            var symbol = [
                data[0].symbol || mlOption.symbol[0],
                data[1].symbol || mlOption.symbol[1]
            ];
            var symbolSize = [
                data[0].symbolSize || mlOption.symbolSize[0],
                data[1].symbolSize || mlOption.symbolSize[1]
            ];
            symbolSize[0] = typeof symbolSize[0] === 'function'
                            ? symbolSize[0](value0)
                            : symbolSize[0];
            symbolSize[1] = typeof symbolSize[1] === 'function'
                            ? symbolSize[1](value1)
                            : symbolSize[1];
            var symbolRotate = [
                this.query(data[0], 'symbolRotate') || mlOption.symbolRotate[0],
                this.query(data[1], 'symbolRotate') || mlOption.symbolRotate[1]
            ];
            //console.log(symbol, symbolSize, symbolRotate);

            var queryTarget = [data[0], data[1], mlOption];
            var normal = this.deepMerge(
                queryTarget,
                'itemStyle.normal'
            );
            normal.color = this.getItemStyleColor(normal.color, seriesIndex, dataIndex, data);
            var emphasis = this.deepMerge(
                queryTarget,
                'itemStyle.emphasis'
            );
            emphasis.color = this.getItemStyleColor(emphasis.color, seriesIndex, dataIndex, data);
            
            var nlineStyle = normal.lineStyle;
            var elineStyle = emphasis.lineStyle;
            
            var nBorderWidth = nlineStyle.width;
            if (nBorderWidth == null) {
                nBorderWidth = normal.borderWidth;
            }
            var eBorderWidth = elineStyle.width;
            if (eBorderWidth == null) {
                eBorderWidth = emphasis.borderWidth != null 
                               ? emphasis.borderWidth
                               : (nBorderWidth + 2);
            }
            var smoothness = this.deepQuery(queryTarget, 'smoothness');
            if (! this.deepQuery(queryTarget, 'smooth')) {
                smoothness = 0;
            }

            var ShapeCtor = bundling ? PolylineShape : MarkLineShape;
            var itemShape = new ShapeCtor({
                style: {
                    symbol: symbol,
                    symbolSize: symbolSize,
                    symbolRotate: symbolRotate,
                    // data: [data[0].name,data[1].name],
                    brushType: 'both',
                    lineType: nlineStyle.type,
                    shadowColor: nlineStyle.shadowColor
                                 || nlineStyle.color
                                 || normal.borderColor
                                 || normal.color
                                 || color,
                    shadowBlur: nlineStyle.shadowBlur,
                    shadowOffsetX: nlineStyle.shadowOffsetX,
                    shadowOffsetY: nlineStyle.shadowOffsetY,
                    color: normal.color || color,
                    strokeColor: nlineStyle.color
                                 || normal.borderColor
                                 || normal.color
                                 || color,
                    lineWidth: nBorderWidth,
                    symbolBorderColor: normal.borderColor
                                       || normal.color
                                       || color,
                    symbolBorder: normal.borderWidth
                },
                highlightStyle: {
                    shadowColor: elineStyle.shadowColor,
                    shadowBlur: elineStyle.shadowBlur,
                    shadowOffsetX: elineStyle.shadowOffsetX,
                    shadowOffsetY: elineStyle.shadowOffsetY,
                    color: emphasis.color|| normal.color || color,
                    strokeColor: elineStyle.color
                                 || nlineStyle.color
                                 || emphasis.borderColor 
                                 || normal.borderColor
                                 || emphasis.color 
                                 || normal.color
                                 || color,
                    lineWidth: eBorderWidth,
                    symbolBorderColor: emphasis.borderColor
                                       || normal.borderColor
                                       || emphasis.color
                                       || normal.color
                                       || color,
                    symbolBorder: emphasis.borderWidth == null
                                  ? (normal.borderWidth + 2)
                                  : (emphasis.borderWidth)
                },
                clickable: this.deepQuery(queryTarget, 'clickable')
            });
            var shapeStyle = itemShape.style;
            if (bundling) {
                shapeStyle.pointList = points;
                shapeStyle.smooth = smoothness;
            }
            else {
                shapeStyle.xStart = points[0][0];
                shapeStyle.yStart = points[0][1];
                shapeStyle.xEnd = points[1][0];
                shapeStyle.yEnd = points[1][1];
                shapeStyle.curveness = smoothness;
                itemShape.updatePoints(itemShape.style);
            }
            
            itemShape = this.addLabel(
                itemShape, 
                mlOption, 
                data[0], 
                data[0].name + ' : ' + data[1].name
            );

            return itemShape;
        },
        
        /**
         * 大规模标注构造器 
         */
        getLargeMarkPointShape: function(seriesIndex, mpOption) {
            var serie = this.series[seriesIndex];
            var component = this.component;
            var data = mpOption.data;
            var itemShape;
            
            var dataRange = component.dataRange;
            var legend = component.legend;
            var color;
            var value;
            var queryTarget = [data[0], mpOption];
            var nColor;
            var eColor;
            var effect;
            
            // 图例
            if (legend) {
                color = legend.getColor(serie.name);
            }
            // 值域
            if (dataRange) {
                value = data[0].value != null ? data[0].value : '';
                color = isNaN(value) ? color : dataRange.getColor(value);
                
                nColor = this.deepQuery(queryTarget, 'itemStyle.normal.color')
                         || color;
                eColor = this.deepQuery(queryTarget, 'itemStyle.emphasis.color')
                         || nColor;
                // 有值域，并且值域返回null且用户没有自己定义颜色，则隐藏这个mark
                if (nColor == null && eColor == null) {
                    return;
                }
            }
            color = this.deepMerge(queryTarget, 'itemStyle.normal').color 
                    || color;
            
            var symbol = this.deepQuery(queryTarget, 'symbol') || 'circle';
            symbol = symbol.replace('empty', '').replace(/\d/g, '');
            
            effect = this.deepMerge(
                [data[0], mpOption],
                'effect'
            );
            
            var devicePixelRatio = window.devicePixelRatio || 1;
            
            //console.log(data)
            itemShape = new SymbolShape({
                style: {
                    pointList: data,
                    color: color,
                    strokeColor: color,
                    shadowColor: effect.shadowColor || color,
                    shadowBlur: (effect.shadowBlur != null ? effect.shadowBlur : 8)
                                 * devicePixelRatio,
                    size: this.deepQuery(queryTarget, 'symbolSize'),
                    iconType: symbol,
                    brushType: 'fill',
                    lineWidth:1
                },
                draggable: false,
                hoverable: false
            });
            
            if (effect.show) {
                itemShape.effect = effect;
            }
            
            return itemShape;
        },
        
        backupShapeList: function () {
            if (this.shapeList && this.shapeList.length > 0) {
                this.lastShapeList = this.shapeList;
                this.shapeList = [];
            }
            else {
                this.lastShapeList = [];
            }
        },
        
        addShapeList: function () {
            var maxLenth = this.option.animationThreshold / (this.canvasSupported ? 2 : 4);
            var lastShapeList = this.lastShapeList;
            var shapeList = this.shapeList;
            var isUpdate = lastShapeList.length > 0;
            var duration = isUpdate
                           ? this.query(this.option, 'animationDurationUpdate')
                           : this.query(this.option, 'animationDuration');
            var easing = this.query(this.option, 'animationEasing');
            var delay;
            var key;
            var oldMap = {};
            var newMap = {};
            if (this.option.animation 
                && !this.option.renderAsImage 
                && shapeList.length < maxLenth
                && !this.motionlessOnce
            ) {
                // 通过已有的shape做动画过渡
                for (var i = 0, l = lastShapeList.length; i < l; i++) {
                    key = this._getAnimationKey(lastShapeList[i]);
                    if (key.match('undefined')) {
                        this.zr.delShape(lastShapeList[i].id);  // 非关键元素直接删除
                    }
                    else {
                        key += lastShapeList[i].type;
                        // https://github.com/ecomfe/echarts/issues/1219#issuecomment-71987602
                        // 响应中断可能产生的重复元素
                        if (oldMap[key]) {
                            this.zr.delShape(lastShapeList[i].id);
                        }
                        else {
                            oldMap[key] = lastShapeList[i];
                        }
                    }
                }
                for (var i = 0, l = shapeList.length; i < l; i++) {
                    key = this._getAnimationKey(shapeList[i]);
                    if (key.match('undefined')) {
                        this.zr.addShape(shapeList[i]);         // 非关键元素直接添加
                    }
                    else {
                        key += shapeList[i].type;
                        newMap[key] = shapeList[i];
                    }
                }
                
                for (key in oldMap) {
                    if (!newMap[key]) {
                        // 新的没有 删除
                        this.zr.delShape(oldMap[key].id);
                    }
                }
                for (key in newMap) {
                    if (oldMap[key]) {
                        // 新旧都有 动画过渡
                        this.zr.delShape(oldMap[key].id);
                        this._animateMod(
                            oldMap[key], newMap[key], duration, easing, 0, isUpdate
                        );
                    }
                    else {
                        // 新有旧没有  添加并动画过渡
                        //this._animateAdd(newMap[key], duration, easing);
                        delay = (this.type == ecConfig.CHART_TYPE_LINE
                                || this.type == ecConfig.CHART_TYPE_RADAR)
                                && key.indexOf('icon') !== 0
                                ? duration / 2
                                : 0;
                        this._animateMod(
                            false, newMap[key], duration, easing, delay, isUpdate
                        );
                    }
                }
                this.zr.refresh();
                this.animationEffect();
            }
            else {
                this.motionlessOnce = false;
                // clear old
                this.zr.delShape(lastShapeList);
                // 直接添加
                for (var i = 0, l = shapeList.length; i < l; i++) {
                    this.zr.addShape(shapeList[i]);
                }
            }
        },
        
        _getAnimationKey: function(shape) {
            if (this.type != ecConfig.CHART_TYPE_MAP
                && this.type != ecConfig.CHART_TYPE_TREEMAP
                && this.type != ecConfig.CHART_TYPE_VENN
                && this.type != ecConfig.CHART_TYPE_TREE
                ) {
                return ecData.get(shape, 'seriesIndex') + '_'
                       + ecData.get(shape, 'dataIndex')
                       + (shape._mark ? shape._mark : '')
                       + (this.type === ecConfig.CHART_TYPE_RADAR 
                          ? ecData.get(shape, 'special') : '');
            }
            else {
                return ecData.get(shape, 'seriesIndex') + '_'
                       + ecData.get(shape, 'dataIndex')
                       + (shape._mark ? shape._mark : 'undefined');
            }
        },
        
        /**
         * 动画过渡 
         */
        _animateMod: function (oldShape, newShape, duration, easing, delay, isUpdate) {
            switch (newShape.type) {
                case 'polyline' :
                case 'half-smooth-polygon' :
                    ecAnimation.pointList(this.zr, oldShape, newShape, duration, easing);
                    break;
                case 'rectangle' :
                    ecAnimation.rectangle(this.zr, oldShape, newShape, duration, easing);
                    break;
                case 'image' :
                case 'icon' :
                    ecAnimation.icon(this.zr, oldShape, newShape, duration, easing, delay);
                    break;
                case 'candle' :
                    if (!isUpdate) {
                        ecAnimation.candle(this.zr, oldShape, newShape, duration, easing);
                    }
                    else {
                        this.zr.addShape(newShape);
                    }
                    break;
                case 'ring' :
                case 'sector' :
                case 'circle' :
                    if (!isUpdate) {
                        // 进入动画，加旋转
                        ecAnimation.ring(
                            this.zr,
                            oldShape,
                            newShape, 
                            duration + ((ecData.get(newShape, 'dataIndex') || 0) % 20 * 100), 
                            easing
                        );
                    }
                    else if (newShape.type === 'sector') {
                        ecAnimation.sector(this.zr, oldShape, newShape, duration, easing);
                    }
                    else {
                        this.zr.addShape(newShape);
                    }
                    break;
                case 'text' :
                    ecAnimation.text(this.zr, oldShape, newShape, duration, easing);
                    break;
                case 'polygon' :
                    if (!isUpdate) {
                        ecAnimation.polygon(this.zr, oldShape, newShape, duration, easing);
                    }
                    else {
                        ecAnimation.pointList(this.zr, oldShape, newShape, duration, easing);
                    }
                    break;
                case 'ribbon' :
                    ecAnimation.ribbon(this.zr, oldShape, newShape, duration, easing);
                    break;
                case 'gauge-pointer' :
                    ecAnimation.gaugePointer(this.zr, oldShape, newShape, duration, easing);
                    break;
                case 'mark-line' :
                    ecAnimation.markline(this.zr, oldShape, newShape, duration, easing);
                    break;
                case 'bezier-curve' :
                case 'line' :
                    ecAnimation.line(this.zr, oldShape, newShape, duration, easing);
                    break;
                default :
                    this.zr.addShape(newShape);
                    break;
            }
        },
        
        /**
         * 标注动画
         * @param {number} duration 时长
         * @param {string=} easing 缓动效果
         * @param {Array=} shapeList 指定特效对象，不指定默认使用this.shapeList
         */
        animationMark: function (duration , easing, shapeList) {
            var shapeList = shapeList || this.shapeList;
            for (var i = 0, l = shapeList.length; i < l; i++) {
                if (!shapeList[i]._mark) {
                    continue;
                }
                this._animateMod(false, shapeList[i], duration, easing, 0, true);
            }
            this.animationEffect(shapeList);
        },

        /**
         * 特效动画
         * @param {Array=} shapeList 指定特效对象，不知道默认使用this.shapeList
         */
        animationEffect: function (shapeList) {
            !shapeList && this.clearEffectShape();
            shapeList = shapeList || this.shapeList;
            if (shapeList == null) {
                return;
            }
            var zlevel = ecConfig.EFFECT_ZLEVEL;
            if (this.canvasSupported) {
                this.zr.modLayer(
                    zlevel,
                    {
                        motionBlur: true,
                        lastFrameAlpha: 0.95
                    }
                );
            }
            var shape;
            for (var i = 0, l = shapeList.length; i < l; i++) {
                shape = shapeList[i];
                if (!(shape._mark && shape.effect && shape.effect.show && ecEffect[shape._mark])) {
                    continue;
                }
                ecEffect[shape._mark](this.zr, this.effectList, shape, zlevel);
                this.effectList[this.effectList.length - 1]._mark = shape._mark;
            }
        },
        
        clearEffectShape: function (clearMotionBlur) {
            var effectList = this.effectList;
            if (this.zr && effectList && effectList.length > 0) {
                clearMotionBlur && this.zr.modLayer(
                    ecConfig.EFFECT_ZLEVEL, 
                    { motionBlur: false }
                );
                this.zr.delShape(effectList);

                // 手动清除不会被 zr 自动清除的动画控制器
                for (var i = 0; i < effectList.length; i++) {
                    if (effectList[i].effectAnimator) {
                        effectList[i].effectAnimator.stop();
                    }
                }
            }
            this.effectList = [];
        },
        
        /**
         * 动态标线标注添加
         * @param {number} seriesIndex 系列索引
         * @param {Object} markData 标线标注对象，支持多个
         * @param {string} markType 标线标注类型
         */
        addMark: function (seriesIndex, markData, markType) {
            var serie = this.series[seriesIndex];
            if (this.selectedMap[serie.name]) {
                var duration = this.query(this.option, 'animationDurationUpdate');
                var easing = this.query(this.option, 'animationEasing');
                // 备份，复用_buildMarkX
                var oriMarkData = serie[markType].data;
                var lastLength = this.shapeList.length;
                
                serie[markType].data = markData.data;
                this['_build' + markType.replace('m', 'M')](seriesIndex);
                if (this.option.animation && !this.option.renderAsImage) {
                    // animationMark就会addShape
                    this.animationMark(duration, easing, this.shapeList.slice(lastLength));
                }
                else {
                    for (var i = lastLength, l = this.shapeList.length; i < l; i++) {
                        this.zr.addShape(this.shapeList[i]);
                    }
                    this.zr.refreshNextFrame();
                }
                // 还原，复用_buildMarkX
                serie[markType].data = oriMarkData;
            }
        },
        
        /**
         * 动态标线标注删除
         * @param {number} seriesIndex 系列索引
         * @param {string} markName 标线标注名称
         * @param {string} markType 标线标注类型
         */
        delMark: function (seriesIndex, markName, markType) {
            markType = markType.replace('mark', '').replace('large', '').toLowerCase();
            var serie = this.series[seriesIndex];
            if (this.selectedMap[serie.name]) {
                var needRefresh = false;
                var shapeList = [this.shapeList, this.effectList];
                var len = 2;
                while(len--) {
                    for (var i = 0, l = shapeList[len].length; i < l; i++) {
                        if (shapeList[len][i]._mark == markType
                            && ecData.get(shapeList[len][i], 'seriesIndex') == seriesIndex
                            && ecData.get(shapeList[len][i], 'name') == markName
                        ) {
                            this.zr.delShape(shapeList[len][i].id);
                            shapeList[len].splice(i, 1);
                            needRefresh = true;
                            break;
                        }
                    }
                }
                
                needRefresh && this.zr.refreshNextFrame();
            }
        }
    };

    zrUtil.inherits(Base, ComponentBase);

    return Base;
});
define('zrender/shape/Text', ['require', '../tool/area', './Base', '../tool/util'], function (require) {
        var area = require('../tool/area');
        var Base = require('./Base');
        
        /**
         * @alias module:zrender/shape/Text
         * @constructor
         * @extends module:zrender/shape/Base
         * @param {Object} options
         */
        var Text = function (options) {
            Base.call(this, options);
            /**
             * 文字绘制样式
             * @name module:zrender/shape/Text#style
             * @type {module:zrender/shape/Text~ITextStyle}
             */
            /**
             * 文字高亮绘制样式
             * @name module:zrender/shape/Text#highlightStyle
             * @type {module:zrender/shape/Text~ITextStyle}
             */
        };

        Text.prototype =  {
            type: 'text',

            brush : function (ctx, isHighlight) {
                var style = this.style;
                if (isHighlight) {
                    // 根据style扩展默认高亮样式
                    style = this.getHighlightStyle(
                        style, this.highlightStyle || {}
                    );
                }
                
                if (typeof(style.text) == 'undefined' || style.text === false) {
                    return;
                }

                ctx.save();
                this.doClip(ctx);

                this.setContext(ctx, style);

                // 设置transform
                this.setTransform(ctx);

                if (style.textFont) {
                    ctx.font = style.textFont;
                }
                ctx.textAlign = style.textAlign || 'start';
                ctx.textBaseline = style.textBaseline || 'middle';

                var text = (style.text + '').split('\n');
                var lineHeight = area.getTextHeight('国', style.textFont);
                var rect = this.getRect(style);
                var x = style.x;
                var y;
                if (style.textBaseline == 'top') {
                    y = rect.y;
                }
                else if (style.textBaseline == 'bottom') {
                    y = rect.y + lineHeight;
                }
                else {
                    y = rect.y + lineHeight / 2;
                }
                
                for (var i = 0, l = text.length; i < l; i++) {
                    if (style.maxWidth) {
                        switch (style.brushType) {
                            case 'fill':
                                ctx.fillText(
                                    text[i],
                                    x, y, style.maxWidth
                                );
                                break;
                            case 'stroke':
                                ctx.strokeText(
                                    text[i],
                                    x, y, style.maxWidth
                                );
                                break;
                            case 'both':
                                ctx.fillText(
                                    text[i],
                                    x, y, style.maxWidth
                                );
                                ctx.strokeText(
                                    text[i],
                                    x, y, style.maxWidth
                                );
                                break;
                            default:
                                ctx.fillText(
                                    text[i],
                                    x, y, style.maxWidth
                                );
                        }
                    }
                    else {
                        switch (style.brushType) {
                            case 'fill':
                                ctx.fillText(text[i], x, y);
                                break;
                            case 'stroke':
                                ctx.strokeText(text[i], x, y);
                                break;
                            case 'both':
                                ctx.fillText(text[i], x, y);
                                ctx.strokeText(text[i], x, y);
                                break;
                            default:
                                ctx.fillText(text[i], x, y);
                        }
                    }
                    y += lineHeight;
                }

                ctx.restore();
                return;
            },

            /**
             * 返回文字包围盒矩形
             * @param {module:zrender/shape/Text~ITextStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function (style) {
                if (style.__rect) {
                    return style.__rect;
                }
                
                var width = area.getTextWidth(style.text, style.textFont);
                var height = area.getTextHeight(style.text, style.textFont);
                
                var textX = style.x;                 // 默认start == left
                if (style.textAlign == 'end' || style.textAlign == 'right') {
                    textX -= width;
                }
                else if (style.textAlign == 'center') {
                    textX -= (width / 2);
                }

                var textY;
                if (style.textBaseline == 'top') {
                    textY = style.y;
                }
                else if (style.textBaseline == 'bottom') {
                    textY = style.y - height;
                }
                else {
                    // middle
                    textY = style.y - height / 2;
                }

                style.__rect = {
                    x : textX,
                    y : textY,
                    width : width,
                    height : height
                };
                
                return style.__rect;
            }
        };

        require('../tool/util').inherits(Text, Base);
        return Text;
    });
define('echarts/theme/infographic', [], function () {

var theme = {
    // 默认色板
    color: [
        '#C1232B','#B5C334','#FCCE10','#E87C25','#27727B',
        '#FE8463','#9BCA63','#FAD860','#F3A43B','#60C0DD',
        '#D7504B','#C6E579','#F4E001','#F0805A','#26C0C0'
    ],

    // 图表标题
    title: {
        textStyle: {
            fontWeight: 'normal',
            color: '#27727B'          // 主标题文字颜色
        }
    },

    // 值域
    dataRange: {
        x:'right',
        y:'center',
        itemWidth: 5,
        itemHeight:25,
        color:['#C1232B','#FCCE10']
    },

    toolbox: {
        color : [
            '#C1232B','#B5C334','#FCCE10','#E87C25','#27727B',
            '#FE8463','#9BCA63','#FAD860','#F3A43B','#60C0DD'
        ],
        effectiveColor : '#ff4500'
    },

    // 提示框
    tooltip: {
        backgroundColor: 'rgba(50,50,50,0.5)',     // 提示背景颜色，默认为透明度为0.7的黑色
        axisPointer : {            // 坐标轴指示器，坐标轴触发有效
            type : 'line',         // 默认为直线，可选为：'line' | 'shadow'
            lineStyle : {          // 直线指示器样式设置
                color: '#27727B',
                type: 'dashed'
            },
            crossStyle: {
                color: '#27727B'
            },
            shadowStyle : {                     // 阴影指示器样式设置
                color: 'rgba(200,200,200,0.3)'
            }
        }
    },

    // 区域缩放控制器
    dataZoom: {
        dataBackgroundColor: 'rgba(181,195,52,0.3)',            // 数据背景颜色
        fillerColor: 'rgba(181,195,52,0.2)',   // 填充颜色
        handleColor: '#27727B'    // 手柄颜色
    },

    // 网格
    grid: {
        borderWidth:0
    },

    // 类目轴
    categoryAxis: {
        axisLine: {            // 坐标轴线
            lineStyle: {       // 属性lineStyle控制线条样式
                color: '#27727B'
            }
        },
        splitLine: {           // 分隔线
            show: false
        }
    },

    // 数值型坐标轴默认参数
    valueAxis: {
        axisLine: {            // 坐标轴线
            show: false
        },
        splitArea : {
            show: false
        },
        splitLine: {           // 分隔线
            lineStyle: {       // 属性lineStyle（详见lineStyle）控制线条样式
                color: ['#ccc'],
                type: 'dashed'
            }
        }
    },

    polar : {
        axisLine: {            // 坐标轴线
            lineStyle: {       // 属性lineStyle控制线条样式
                color: '#ddd'
            }
        },
        splitArea : {
            show : true,
            areaStyle : {
                color: ['rgba(250,250,250,0.2)','rgba(200,200,200,0.2)']
            }
        },
        splitLine : {
            lineStyle : {
                color : '#ddd'
            }
        }
    },

    timeline : {
        lineStyle : {
            color : '#27727B'
        },
        controlStyle : {
            normal : { color : '#27727B'},
            emphasis : { color : '#27727B'}
        },
        symbol : 'emptyCircle',
        symbolSize : 3
    },

    // 折线图默认参数
    line: {
        itemStyle: {
            normal: {
                borderWidth:2,
                borderColor:'#fff',
                lineStyle: {
                    width: 3
                }
            },
            emphasis: {
                borderWidth:0
            }
        },
        symbol: 'circle',  // 拐点图形类型
        symbolSize: 3.5           // 拐点图形大小
    },

    // K线图默认参数
    k: {
        itemStyle: {
            normal: {
                color: '#C1232B',       // 阳线填充颜色
                color0: '#B5C334',      // 阴线填充颜色
                lineStyle: {
                    width: 1,
                    color: '#C1232B',   // 阳线边框颜色
                    color0: '#B5C334'   // 阴线边框颜色
                }
            }
        }
    },

    // 散点图默认参数
    scatter: {
        itemStyle: {
            normal: {
                borderWidth:1,
                borderColor:'rgba(200,200,200,0.5)'
            },
            emphasis: {
                borderWidth:0
            }
        },
        symbol: 'star4',    // 图形类型
        symbolSize: 4        // 图形大小，半宽（半径）参数，当图形为方向或菱形则总宽度为symbolSize * 2
    },

    // 雷达图默认参数
    radar : {
        symbol: 'emptyCircle',    // 图形类型
        symbolSize:3
        //symbol: null,         // 拐点图形类型
        //symbolRotate : null,  // 图形旋转控制
    },

    map: {
        itemStyle: {
            normal: {
                areaStyle: {
                    color: '#ddd'
                },
                label: {
                    textStyle: {
                        color: '#C1232B'
                    }
                }
            },
            emphasis: {                 // 也是选中样式
                areaStyle: {
                    color: '#fe994e'
                },
                label: {
                    textStyle: {
                        color: 'rgb(100,0,0)'
                    }
                }
            }
        }
    },

    force : {
        itemStyle: {
            normal: {
                linkStyle : {
                    color : '#27727B'
                }
            }
        }
    },

    chord : {
        itemStyle : {
            normal : {
                borderWidth: 1,
                borderColor: 'rgba(128, 128, 128, 0.5)',
                chordStyle : {
                    lineStyle : {
                        color : 'rgba(128, 128, 128, 0.5)'
                    }
                }
            },
            emphasis : {
                borderWidth: 1,
                borderColor: 'rgba(128, 128, 128, 0.5)',
                chordStyle : {
                    lineStyle : {
                        color : 'rgba(128, 128, 128, 0.5)'
                    }
                }
            }
        }
    },

    gauge : {
        center:['50%','80%'],
        radius:'100%',
        startAngle: 180,
        endAngle : 0,
        axisLine: {            // 坐标轴线
            show: true,        // 默认显示，属性show控制显示与否
            lineStyle: {       // 属性lineStyle控制线条样式
                color: [[0.2, '#B5C334'],[0.8, '#27727B'],[1, '#C1232B']],
                width: '40%'
            }
        },
        axisTick: {            // 坐标轴小标记
            splitNumber: 2,   // 每份split细分多少段
            length: 5,        // 属性length控制线长
            lineStyle: {       // 属性lineStyle控制线条样式
                color: '#fff'
            }
        },
        axisLabel: {           // 坐标轴文本标签，详见axis.axisLabel
            textStyle: {       // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                color: '#fff',
                fontWeight:'bolder'
            }
        },
        splitLine: {           // 分隔线
            length: '5%',         // 属性length控制线长
            lineStyle: {       // 属性lineStyle（详见lineStyle）控制线条样式
                color: '#fff'
            }
        },
        pointer : {
            width : '40%',
            length: '80%',
            color: '#fff'
        },
        title : {
          offsetCenter: [0, -20],       // x, y，单位px
          textStyle: {       // 其余属性默认使用全局文本样式，详见TEXTSTYLE
            color: 'auto',
            fontSize: 20
          }
        },
        detail : {
            offsetCenter: [0, 0],       // x, y，单位px
            textStyle: {       // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                color: 'auto',
                fontSize: 40
            }
        }
    },

    textStyle: {
        fontFamily: '微软雅黑, Arial, Verdana, sans-serif'
    }
};

    return theme;
});
define('zrender/shape/Ring', ['require', './Base', '../tool/util'], function (require) {
        var Base = require('./Base');
        
        /**
         * @alias module:zrender/shape/Ring
         * @constructor
         * @extends module:zrender/shape/Base
         * @param {Object} options
         */
        var Ring = function (options) {
            Base.call(this, options);
            /**
             * 圆环绘制样式
             * @name module:zrender/shape/Ring#style
             * @type {module:zrender/shape/Ring~IRingStyle}
             */
            /**
             * 圆环高亮绘制样式
             * @name module:zrender/shape/Ring#highlightStyle
             * @type {module:zrender/shape/Ring~IRingStyle}
             */
        };

        Ring.prototype = {
            type: 'ring',

            /**
             * 创建圆环路径
             * @param {CanvasRenderingContext2D} ctx
             * @param {module:zrender/shape/Ring~IRingStyle} style
             */
            buildPath : function (ctx, style) {
                // 非零环绕填充优化
                ctx.arc(style.x, style.y, style.r, 0, Math.PI * 2, false);
                ctx.moveTo(style.x + style.r0, style.y);
                ctx.arc(style.x, style.y, style.r0, 0, Math.PI * 2, true);
                return;
            },

            /**
             * 计算返回圆环包围盒矩阵
             * @param {module:zrender/shape/Ring~IRingStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function (style) {
                if (style.__rect) {
                    return style.__rect;
                }
                
                var lineWidth;
                if (style.brushType == 'stroke' || style.brushType == 'fill') {
                    lineWidth = style.lineWidth || 1;
                }
                else {
                    lineWidth = 0;
                }
                style.__rect = {
                    x : Math.round(style.x - style.r - lineWidth / 2),
                    y : Math.round(style.y - style.r - lineWidth / 2),
                    width : style.r * 2 + lineWidth,
                    height : style.r * 2 + lineWidth
                };
                
                return style.__rect;
            }
        };

        require('../tool/util').inherits(Ring, Base);
        return Ring;
    });
define('zrender/shape/Circle', ['require', './Base', '../tool/util'], function (require) {
        'use strict';

        var Base = require('./Base');

        /**
         * @alias module:zrender/shape/Circle
         * @constructor
         * @extends module:zrender/shape/Base
         * @param {Object} options
         */
        var Circle = function(options) {
            Base.call(this, options);
            /**
             * 圆形绘制样式
             * @name module:zrender/shape/Circle#style
             * @type {module:zrender/shape/Circle~ICircleStyle}
             */
            /**
             * 圆形高亮绘制样式
             * @name module:zrender/shape/Circle#highlightStyle
             * @type {module:zrender/shape/Circle~ICircleStyle}
             */
        };

        Circle.prototype = {
            type: 'circle',
            /**
             * 创建圆形路径
             * @param {CanvasRenderingContext2D} ctx
             * @param {module:zrender/shape/Circle~ICircleStyle} style
             */
            buildPath : function (ctx, style) {
                // Better stroking in ShapeBundle
                ctx.moveTo(style.x + style.r, style.y);
                ctx.arc(style.x, style.y, style.r, 0, Math.PI * 2, true);
                return;
            },

            /**
             * 计算返回圆形的包围盒矩形
             * @param {module:zrender/shape/Circle~ICircleStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function (style) {
                if (style.__rect) {
                    return style.__rect;
                }
                
                var lineWidth;
                if (style.brushType == 'stroke' || style.brushType == 'fill') {
                    lineWidth = style.lineWidth || 1;
                }
                else {
                    lineWidth = 0;
                }
                style.__rect = {
                    x : Math.round(style.x - style.r - lineWidth / 2),
                    y : Math.round(style.y - style.r - lineWidth / 2),
                    width : style.r * 2 + lineWidth,
                    height : style.r * 2 + lineWidth
                };
                
                return style.__rect;
            }
        };

        require('../tool/util').inherits(Circle, Base);
        return Circle;
    });
define('zrender/shape/Polyline', ['require', './Base', './util/smoothSpline', './util/smoothBezier', './util/dashedLineTo', './Polygon', '../tool/util'], function (require) {
        var Base = require('./Base');
        var smoothSpline = require('./util/smoothSpline');
        var smoothBezier = require('./util/smoothBezier');
        var dashedLineTo = require('./util/dashedLineTo');

        /**
         * @alias module:zrender/shape/Polyline
         * @constructor
         * @extends module:zrender/shape/Base
         * @param {Object} options
         */
        var Polyline = function(options) {
            this.brushTypeOnly = 'stroke';  // 线条只能描边，填充后果自负
            this.textPosition = 'end';
            Base.call(this, options);
            /**
             * 贝赛尔曲线绘制样式
             * @name module:zrender/shape/Polyline#style
             * @type {module:zrender/shape/Polyline~IPolylineStyle}
             */
            /**
             * 贝赛尔曲线高亮绘制样式
             * @name module:zrender/shape/Polyline#highlightStyle
             * @type {module:zrender/shape/Polyline~IPolylineStyle}
             */
        };

        Polyline.prototype =  {
            type: 'polyline',

            /**
             * 创建多边形路径
             * @param {CanvasRenderingContext2D} ctx
             * @param {module:zrender/shape/Polyline~IPolylineStyle} style
             */
            buildPath : function(ctx, style) {
                var pointList = style.pointList;
                if (pointList.length < 2) {
                    // 少于2个点就不画了~
                    return;
                }
                
                var len = Math.min(
                    style.pointList.length, 
                    Math.round(style.pointListLength || style.pointList.length)
                );
                
                if (style.smooth && style.smooth !== 'spline') {
                    if (! style.controlPointList) {
                        this.updateControlPoints(style);
                    }
                    var controlPointList = style.controlPointList;

                    ctx.moveTo(pointList[0][0], pointList[0][1]);
                    var cp1;
                    var cp2;
                    var p;
                    for (var i = 0; i < len - 1; i++) {
                        cp1 = controlPointList[i * 2];
                        cp2 = controlPointList[i * 2 + 1];
                        p = pointList[i + 1];
                        ctx.bezierCurveTo(
                            cp1[0], cp1[1], cp2[0], cp2[1], p[0], p[1]
                        );
                    }
                }
                else {
                    if (style.smooth === 'spline') {
                        pointList = smoothSpline(pointList);
                        len = pointList.length;
                    }
                    if (!style.lineType || style.lineType == 'solid') {
                        // 默认为实线
                        ctx.moveTo(pointList[0][0], pointList[0][1]);
                        for (var i = 1; i < len; i++) {
                            ctx.lineTo(pointList[i][0], pointList[i][1]);
                        }
                    }
                    else if (style.lineType == 'dashed'
                            || style.lineType == 'dotted'
                    ) {
                        var dashLength = (style.lineWidth || 1) 
                                         * (style.lineType == 'dashed' ? 5 : 1);
                        ctx.moveTo(pointList[0][0], pointList[0][1]);
                        for (var i = 1; i < len; i++) {
                            dashedLineTo(
                                ctx,
                                pointList[i - 1][0], pointList[i - 1][1],
                                pointList[i][0], pointList[i][1],
                                dashLength
                            );
                        }
                    }
                }
                return;
            },

            updateControlPoints: function (style) {
                style.controlPointList = smoothBezier(
                    style.pointList, style.smooth, false, style.smoothConstraint
                );
            },

            /**
             * 计算返回折线包围盒矩形。
             * @param {IZRenderBezierCurveStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function(style) {
                return require('./Polygon').prototype.getRect(style);
            }
        };

        require('../tool/util').inherits(Polyline, Base);
        return Polyline;
    });
define('zrender/tool/math', [], function () {

        var _radians = Math.PI / 180;

        /**
         * @param {number} angle 弧度（角度）参数
         * @param {boolean} isDegrees angle参数是否为角度计算，默认为false，angle为以弧度计量的角度
         */
        function sin(angle, isDegrees) {
            return Math.sin(isDegrees ? angle * _radians : angle);
        }

        /**
         * @param {number} angle 弧度（角度）参数
         * @param {boolean} isDegrees angle参数是否为角度计算，默认为false，angle为以弧度计量的角度
         */
        function cos(angle, isDegrees) {
            return Math.cos(isDegrees ? angle * _radians : angle);
        }

        /**
         * 角度转弧度
         * @param {Object} angle
         */
        function degreeToRadian(angle) {
            return angle * _radians;
        }

        /**
         * 弧度转角度
         * @param {Object} angle
         */
        function radianToDegree(angle) {
            return angle / _radians;
        }

        return {
            sin : sin,
            cos : cos,
            degreeToRadian : degreeToRadian,
            radianToDegree : radianToDegree
        };
    });
define('zrender/dep/excanvas', ['require'], function (require) {
    
// Only add this code if we do not already have a canvas implementation
if (!document.createElement('canvas').getContext) {

(function() {

  // alias some functions to make (compiled) code shorter
  var m = Math;
  var mr = m.round;
  var ms = m.sin;
  var mc = m.cos;
  var abs = m.abs;
  var sqrt = m.sqrt;

  // this is used for sub pixel precision
  var Z = 10;
  var Z2 = Z / 2;

  var IE_VERSION = +navigator.userAgent.match(/MSIE ([\d.]+)?/)[1];

  /**
   * This funtion is assigned to the <canvas> elements as element.getContext().
   * @this {HTMLElement}
   * @return {CanvasRenderingContext2D_}
   */
  function getContext() {
    return this.context_ ||
        (this.context_ = new CanvasRenderingContext2D_(this));
  }

  var slice = Array.prototype.slice;

  /**
   * Binds a function to an object. The returned function will always use the
   * passed in {@code obj} as {@code this}.
   *
   * Example:
   *
   *   g = bind(f, obj, a, b)
   *   g(c, d) // will do f.call(obj, a, b, c, d)
   *
   * @param {Function} f The function to bind the object to
   * @param {Object} obj The object that should act as this when the function
   *     is called
   * @param {*} var_args Rest arguments that will be used as the initial
   *     arguments when the function is called
   * @return {Function} A new function that has bound this
   */
  function bind(f, obj, var_args) {
    var a = slice.call(arguments, 2);
    return function() {
      return f.apply(obj, a.concat(slice.call(arguments)));
    };
  }

  function encodeHtmlAttribute(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function addNamespace(doc, prefix, urn) {
    if (!doc.namespaces[prefix]) {
      doc.namespaces.add(prefix, urn, '#default#VML');
    }
  }

  function addNamespacesAndStylesheet(doc) {
    addNamespace(doc, 'g_vml_', 'urn:schemas-microsoft-com:vml');
    addNamespace(doc, 'g_o_', 'urn:schemas-microsoft-com:office:office');

    // Setup default CSS.  Only add one style sheet per document
    if (!doc.styleSheets['ex_canvas_']) {
      var ss = doc.createStyleSheet();
      ss.owningElement.id = 'ex_canvas_';
      ss.cssText = 'canvas{display:inline-block;overflow:hidden;' +
          // default size is 300x150 in Gecko and Opera
          'text-align:left;width:300px;height:150px}';
    }
  }

  // Add namespaces and stylesheet at startup.
  addNamespacesAndStylesheet(document);

  var G_vmlCanvasManager_ = {
    init: function(opt_doc) {
      var doc = opt_doc || document;
      // Create a dummy element so that IE will allow canvas elements to be
      // recognized.
      doc.createElement('canvas');
      doc.attachEvent('onreadystatechange', bind(this.init_, this, doc));
    },

    init_: function(doc) {
      // find all canvas elements
      var els = doc.getElementsByTagName('canvas');
      for (var i = 0; i < els.length; i++) {
        this.initElement(els[i]);
      }
    },

    /**
     * Public initializes a canvas element so that it can be used as canvas
     * element from now on. This is called automatically before the page is
     * loaded but if you are creating elements using createElement you need to
     * make sure this is called on the element.
     * @param {HTMLElement} el The canvas element to initialize.
     * @return {HTMLElement} the element that was created.
     */
    initElement: function(el) {
      if (!el.getContext) {
        el.getContext = getContext;

        // Add namespaces and stylesheet to document of the element.
        addNamespacesAndStylesheet(el.ownerDocument);

        // Remove fallback content. There is no way to hide text nodes so we
        // just remove all childNodes. We could hide all elements and remove
        // text nodes but who really cares about the fallback content.
        el.innerHTML = '';

        // do not use inline function because that will leak memory
        el.attachEvent('onpropertychange', onPropertyChange);
        el.attachEvent('onresize', onResize);

        var attrs = el.attributes;
        if (attrs.width && attrs.width.specified) {
          // TODO: use runtimeStyle and coordsize
          // el.getContext().setWidth_(attrs.width.nodeValue);
          el.style.width = attrs.width.nodeValue + 'px';
        } else {
          el.width = el.clientWidth;
        }
        if (attrs.height && attrs.height.specified) {
          // TODO: use runtimeStyle and coordsize
          // el.getContext().setHeight_(attrs.height.nodeValue);
          el.style.height = attrs.height.nodeValue + 'px';
        } else {
          el.height = el.clientHeight;
        }
        //el.getContext().setCoordsize_()
      }
      return el;
    }
  };

  function onPropertyChange(e) {
    var el = e.srcElement;

    switch (e.propertyName) {
      case 'width':
        el.getContext().clearRect();
        el.style.width = el.attributes.width.nodeValue + 'px';
        // In IE8 this does not trigger onresize.
        el.firstChild.style.width =  el.clientWidth + 'px';
        break;
      case 'height':
        el.getContext().clearRect();
        el.style.height = el.attributes.height.nodeValue + 'px';
        el.firstChild.style.height = el.clientHeight + 'px';
        break;
    }
  }

  function onResize(e) {
    var el = e.srcElement;
    if (el.firstChild) {
      el.firstChild.style.width =  el.clientWidth + 'px';
      el.firstChild.style.height = el.clientHeight + 'px';
    }
  }

  G_vmlCanvasManager_.init();

  // precompute "00" to "FF"
  var decToHex = [];
  for (var i = 0; i < 16; i++) {
    for (var j = 0; j < 16; j++) {
      decToHex[i * 16 + j] = i.toString(16) + j.toString(16);
    }
  }

  function createMatrixIdentity() {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
  }

  function matrixMultiply(m1, m2) {
    var result = createMatrixIdentity();

    for (var x = 0; x < 3; x++) {
      for (var y = 0; y < 3; y++) {
        var sum = 0;

        for (var z = 0; z < 3; z++) {
          sum += m1[x][z] * m2[z][y];
        }

        result[x][y] = sum;
      }
    }
    return result;
  }

  function copyState(o1, o2) {
    o2.fillStyle     = o1.fillStyle;
    o2.lineCap       = o1.lineCap;
    o2.lineJoin      = o1.lineJoin;
    o2.lineWidth     = o1.lineWidth;
    o2.miterLimit    = o1.miterLimit;
    o2.shadowBlur    = o1.shadowBlur;
    o2.shadowColor   = o1.shadowColor;
    o2.shadowOffsetX = o1.shadowOffsetX;
    o2.shadowOffsetY = o1.shadowOffsetY;
    o2.strokeStyle   = o1.strokeStyle;
    o2.globalAlpha   = o1.globalAlpha;
    o2.font          = o1.font;
    o2.textAlign     = o1.textAlign;
    o2.textBaseline  = o1.textBaseline;
    o2.scaleX_    = o1.scaleX_;
    o2.scaleY_    = o1.scaleY_;
    o2.lineScale_    = o1.lineScale_;
  }

  var colorData = {
    aliceblue: '#F0F8FF',
    antiquewhite: '#FAEBD7',
    aquamarine: '#7FFFD4',
    azure: '#F0FFFF',
    beige: '#F5F5DC',
    bisque: '#FFE4C4',
    black: '#000000',
    blanchedalmond: '#FFEBCD',
    blueviolet: '#8A2BE2',
    brown: '#A52A2A',
    burlywood: '#DEB887',
    cadetblue: '#5F9EA0',
    chartreuse: '#7FFF00',
    chocolate: '#D2691E',
    coral: '#FF7F50',
    cornflowerblue: '#6495ED',
    cornsilk: '#FFF8DC',
    crimson: '#DC143C',
    cyan: '#00FFFF',
    darkblue: '#00008B',
    darkcyan: '#008B8B',
    darkgoldenrod: '#B8860B',
    darkgray: '#A9A9A9',
    darkgreen: '#006400',
    darkgrey: '#A9A9A9',
    darkkhaki: '#BDB76B',
    darkmagenta: '#8B008B',
    darkolivegreen: '#556B2F',
    darkorange: '#FF8C00',
    darkorchid: '#9932CC',
    darkred: '#8B0000',
    darksalmon: '#E9967A',
    darkseagreen: '#8FBC8F',
    darkslateblue: '#483D8B',
    darkslategray: '#2F4F4F',
    darkslategrey: '#2F4F4F',
    darkturquoise: '#00CED1',
    darkviolet: '#9400D3',
    deeppink: '#FF1493',
    deepskyblue: '#00BFFF',
    dimgray: '#696969',
    dimgrey: '#696969',
    dodgerblue: '#1E90FF',
    firebrick: '#B22222',
    floralwhite: '#FFFAF0',
    forestgreen: '#228B22',
    gainsboro: '#DCDCDC',
    ghostwhite: '#F8F8FF',
    gold: '#FFD700',
    goldenrod: '#DAA520',
    grey: '#808080',
    greenyellow: '#ADFF2F',
    honeydew: '#F0FFF0',
    hotpink: '#FF69B4',
    indianred: '#CD5C5C',
    indigo: '#4B0082',
    ivory: '#FFFFF0',
    khaki: '#F0E68C',
    lavender: '#E6E6FA',
    lavenderblush: '#FFF0F5',
    lawngreen: '#7CFC00',
    lemonchiffon: '#FFFACD',
    lightblue: '#ADD8E6',
    lightcoral: '#F08080',
    lightcyan: '#E0FFFF',
    lightgoldenrodyellow: '#FAFAD2',
    lightgreen: '#90EE90',
    lightgrey: '#D3D3D3',
    lightpink: '#FFB6C1',
    lightsalmon: '#FFA07A',
    lightseagreen: '#20B2AA',
    lightskyblue: '#87CEFA',
    lightslategray: '#778899',
    lightslategrey: '#778899',
    lightsteelblue: '#B0C4DE',
    lightyellow: '#FFFFE0',
    limegreen: '#32CD32',
    linen: '#FAF0E6',
    magenta: '#FF00FF',
    mediumaquamarine: '#66CDAA',
    mediumblue: '#0000CD',
    mediumorchid: '#BA55D3',
    mediumpurple: '#9370DB',
    mediumseagreen: '#3CB371',
    mediumslateblue: '#7B68EE',
    mediumspringgreen: '#00FA9A',
    mediumturquoise: '#48D1CC',
    mediumvioletred: '#C71585',
    midnightblue: '#191970',
    mintcream: '#F5FFFA',
    mistyrose: '#FFE4E1',
    moccasin: '#FFE4B5',
    navajowhite: '#FFDEAD',
    oldlace: '#FDF5E6',
    olivedrab: '#6B8E23',
    orange: '#FFA500',
    orangered: '#FF4500',
    orchid: '#DA70D6',
    palegoldenrod: '#EEE8AA',
    palegreen: '#98FB98',
    paleturquoise: '#AFEEEE',
    palevioletred: '#DB7093',
    papayawhip: '#FFEFD5',
    peachpuff: '#FFDAB9',
    peru: '#CD853F',
    pink: '#FFC0CB',
    plum: '#DDA0DD',
    powderblue: '#B0E0E6',
    rosybrown: '#BC8F8F',
    royalblue: '#4169E1',
    saddlebrown: '#8B4513',
    salmon: '#FA8072',
    sandybrown: '#F4A460',
    seagreen: '#2E8B57',
    seashell: '#FFF5EE',
    sienna: '#A0522D',
    skyblue: '#87CEEB',
    slateblue: '#6A5ACD',
    slategray: '#708090',
    slategrey: '#708090',
    snow: '#FFFAFA',
    springgreen: '#00FF7F',
    steelblue: '#4682B4',
    tan: '#D2B48C',
    thistle: '#D8BFD8',
    tomato: '#FF6347',
    turquoise: '#40E0D0',
    violet: '#EE82EE',
    wheat: '#F5DEB3',
    whitesmoke: '#F5F5F5',
    yellowgreen: '#9ACD32'
  };


  function getRgbHslContent(styleString) {
    var start = styleString.indexOf('(', 3);
    var end = styleString.indexOf(')', start + 1);
    var parts = styleString.substring(start + 1, end).split(',');
    // add alpha if needed
    if (parts.length != 4 || styleString.charAt(3) != 'a') {
      parts[3] = 1;
    }
    return parts;
  }

  function percent(s) {
    return parseFloat(s) / 100;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function hslToRgb(parts){
    var r, g, b, h, s, l;
    h = parseFloat(parts[0]) / 360 % 360;
    if (h < 0)
      h++;
    s = clamp(percent(parts[1]), 0, 1);
    l = clamp(percent(parts[2]), 0, 1);
    if (s == 0) {
      r = g = b = l; // achromatic
    } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hueToRgb(p, q, h + 1 / 3);
      g = hueToRgb(p, q, h);
      b = hueToRgb(p, q, h - 1 / 3);
    }

    return '#' + decToHex[Math.floor(r * 255)] +
        decToHex[Math.floor(g * 255)] +
        decToHex[Math.floor(b * 255)];
  }

  function hueToRgb(m1, m2, h) {
    if (h < 0)
      h++;
    if (h > 1)
      h--;

    if (6 * h < 1)
      return m1 + (m2 - m1) * 6 * h;
    else if (2 * h < 1)
      return m2;
    else if (3 * h < 2)
      return m1 + (m2 - m1) * (2 / 3 - h) * 6;
    else
      return m1;
  }

  var processStyleCache = {};

  function processStyle(styleString) {
    if (styleString in processStyleCache) {
      return processStyleCache[styleString];
    }

    var str, alpha = 1;

    styleString = String(styleString);
    if (styleString.charAt(0) == '#') {
      str = styleString;
    } else if (/^rgb/.test(styleString)) {
      var parts = getRgbHslContent(styleString);
      var str = '#', n;
      for (var i = 0; i < 3; i++) {
        if (parts[i].indexOf('%') != -1) {
          n = Math.floor(percent(parts[i]) * 255);
        } else {
          n = +parts[i];
        }
        str += decToHex[clamp(n, 0, 255)];
      }
      alpha = +parts[3];
    } else if (/^hsl/.test(styleString)) {
      var parts = getRgbHslContent(styleString);
      str = hslToRgb(parts);
      alpha = parts[3];
    } else {
      str = colorData[styleString] || styleString;
    }
    return processStyleCache[styleString] = {color: str, alpha: alpha};
  }

  var DEFAULT_STYLE = {
    style: 'normal',
    variant: 'normal',
    weight: 'normal',
    size: 12,           //10
    family: '微软雅黑'     //'sans-serif'
  };

  // Internal text style cache
  var fontStyleCache = {};

  function processFontStyle(styleString) {
    if (fontStyleCache[styleString]) {
      return fontStyleCache[styleString];
    }

    var el = document.createElement('div');
    var style = el.style;
    var fontFamily;
    try {
      style.font = styleString;
      fontFamily = style.fontFamily.split(',')[0];
    } catch (ex) {
      // Ignore failures to set to invalid font.
    }

    return fontStyleCache[styleString] = {
      style: style.fontStyle || DEFAULT_STYLE.style,
      variant: style.fontVariant || DEFAULT_STYLE.variant,
      weight: style.fontWeight || DEFAULT_STYLE.weight,
      size: style.fontSize || DEFAULT_STYLE.size,
      family: fontFamily || DEFAULT_STYLE.family
    };
  }

  function getComputedStyle(style, element) {
    var computedStyle = {};

    for (var p in style) {
      computedStyle[p] = style[p];
    }

    // Compute the size
    var canvasFontSize = parseFloat(element.currentStyle.fontSize),
        fontSize = parseFloat(style.size);

    if (typeof style.size == 'number') {
      computedStyle.size = style.size;
    } else if (style.size.indexOf('px') != -1) {
      computedStyle.size = fontSize;
    } else if (style.size.indexOf('em') != -1) {
      computedStyle.size = canvasFontSize * fontSize;
    } else if(style.size.indexOf('%') != -1) {
      computedStyle.size = (canvasFontSize / 100) * fontSize;
    } else if (style.size.indexOf('pt') != -1) {
      computedStyle.size = fontSize / .75;
    } else {
      computedStyle.size = canvasFontSize;
    }

    // Different scaling between normal text and VML text. This was found using
    // trial and error to get the same size as non VML text.
    //computedStyle.size *= 0.981;

    return computedStyle;
  }

  function buildStyle(style) {
    return style.style + ' ' + style.variant + ' ' + style.weight + ' ' +
        style.size + "px '" + style.family + "'";
  }

  var lineCapMap = {
    'butt': 'flat',
    'round': 'round'
  };

  function processLineCap(lineCap) {
    return lineCapMap[lineCap] || 'square';
  }

  /**
   * This class implements CanvasRenderingContext2D interface as described by
   * the WHATWG.
   * @param {HTMLElement} canvasElement The element that the 2D context should
   * be associated with
   */
  function CanvasRenderingContext2D_(canvasElement) {
    this.m_ = createMatrixIdentity();

    this.mStack_ = [];
    this.aStack_ = [];
    this.currentPath_ = [];

    // Canvas context properties
    this.strokeStyle = '#000';
    this.fillStyle = '#000';

    this.lineWidth = 1;
    this.lineJoin = 'miter';
    this.lineCap = 'butt';
    this.miterLimit = Z * 1;
    this.globalAlpha = 1;
    // this.font = '10px sans-serif';
    this.font = '12px 微软雅黑';        // 决定还是改这吧，影响代价最小
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.canvas = canvasElement;

    var cssText = 'width:' + canvasElement.clientWidth + 'px;height:' +
        canvasElement.clientHeight + 'px;overflow:hidden;position:absolute';
    var el = canvasElement.ownerDocument.createElement('div');
    el.style.cssText = cssText;
    canvasElement.appendChild(el);

    var overlayEl = el.cloneNode(false);
    // Use a non transparent background.
    overlayEl.style.backgroundColor = '#fff'; //red, I don't know why, it work! 
    overlayEl.style.filter = 'alpha(opacity=0)';
    canvasElement.appendChild(overlayEl);

    this.element_ = el;
    this.scaleX_ = 1;
    this.scaleY_ = 1;
    this.lineScale_ = 1;
  }

  var contextPrototype = CanvasRenderingContext2D_.prototype;
  contextPrototype.clearRect = function() {
    if (this.textMeasureEl_) {
      this.textMeasureEl_.removeNode(true);
      this.textMeasureEl_ = null;
    }
    this.element_.innerHTML = '';
  };

  contextPrototype.beginPath = function() {
    // TODO: Branch current matrix so that save/restore has no effect
    //       as per safari docs.
    this.currentPath_ = [];
  };

  contextPrototype.moveTo = function(aX, aY) {
    var p = getCoords(this, aX, aY);
    this.currentPath_.push({type: 'moveTo', x: p.x, y: p.y});
    this.currentX_ = p.x;
    this.currentY_ = p.y;
  };

  contextPrototype.lineTo = function(aX, aY) {
    var p = getCoords(this, aX, aY);
    this.currentPath_.push({type: 'lineTo', x: p.x, y: p.y});

    this.currentX_ = p.x;
    this.currentY_ = p.y;
  };

  contextPrototype.bezierCurveTo = function(aCP1x, aCP1y,
                                            aCP2x, aCP2y,
                                            aX, aY) {
    var p = getCoords(this, aX, aY);
    var cp1 = getCoords(this, aCP1x, aCP1y);
    var cp2 = getCoords(this, aCP2x, aCP2y);
    bezierCurveTo(this, cp1, cp2, p);
  };

  // Helper function that takes the already fixed cordinates.
  function bezierCurveTo(self, cp1, cp2, p) {
    self.currentPath_.push({
      type: 'bezierCurveTo',
      cp1x: cp1.x,
      cp1y: cp1.y,
      cp2x: cp2.x,
      cp2y: cp2.y,
      x: p.x,
      y: p.y
    });
    self.currentX_ = p.x;
    self.currentY_ = p.y;
  }

  contextPrototype.quadraticCurveTo = function(aCPx, aCPy, aX, aY) {
    // the following is lifted almost directly from
    // http://developer.mozilla.org/en/docs/Canvas_tutorial:Drawing_shapes

    var cp = getCoords(this, aCPx, aCPy);
    var p = getCoords(this, aX, aY);

    var cp1 = {
      x: this.currentX_ + 2.0 / 3.0 * (cp.x - this.currentX_),
      y: this.currentY_ + 2.0 / 3.0 * (cp.y - this.currentY_)
    };
    var cp2 = {
      x: cp1.x + (p.x - this.currentX_) / 3.0,
      y: cp1.y + (p.y - this.currentY_) / 3.0
    };

    bezierCurveTo(this, cp1, cp2, p);
  };

  contextPrototype.arc = function(aX, aY, aRadius,
                                  aStartAngle, aEndAngle, aClockwise) {
    aRadius *= Z;
    var arcType = aClockwise ? 'at' : 'wa';

    var xStart = aX + mc(aStartAngle) * aRadius - Z2;
    var yStart = aY + ms(aStartAngle) * aRadius - Z2;

    var xEnd = aX + mc(aEndAngle) * aRadius - Z2;
    var yEnd = aY + ms(aEndAngle) * aRadius - Z2;

    // IE won't render arches drawn counter clockwise if xStart == xEnd.
    if (xStart == xEnd && !aClockwise) {
      xStart += 0.125; // Offset xStart by 1/80 of a pixel. Use something
                       // that can be represented in binary
    }

    var p = getCoords(this, aX, aY);
    var pStart = getCoords(this, xStart, yStart);
    var pEnd = getCoords(this, xEnd, yEnd);

    this.currentPath_.push({type: arcType,
                           x: p.x,
                           y: p.y,
                           radius: aRadius,
                           xStart: pStart.x,
                           yStart: pStart.y,
                           xEnd: pEnd.x,
                           yEnd: pEnd.y});

  };

  contextPrototype.rect = function(aX, aY, aWidth, aHeight) {
    this.moveTo(aX, aY);
    this.lineTo(aX + aWidth, aY);
    this.lineTo(aX + aWidth, aY + aHeight);
    this.lineTo(aX, aY + aHeight);
    this.closePath();
  };

  contextPrototype.strokeRect = function(aX, aY, aWidth, aHeight) {
    var oldPath = this.currentPath_;
    this.beginPath();

    this.moveTo(aX, aY);
    this.lineTo(aX + aWidth, aY);
    this.lineTo(aX + aWidth, aY + aHeight);
    this.lineTo(aX, aY + aHeight);
    this.closePath();
    this.stroke();

    this.currentPath_ = oldPath;
  };

  contextPrototype.fillRect = function(aX, aY, aWidth, aHeight) {
    var oldPath = this.currentPath_;
    this.beginPath();

    this.moveTo(aX, aY);
    this.lineTo(aX + aWidth, aY);
    this.lineTo(aX + aWidth, aY + aHeight);
    this.lineTo(aX, aY + aHeight);
    this.closePath();
    this.fill();

    this.currentPath_ = oldPath;
  };

  contextPrototype.createLinearGradient = function(aX0, aY0, aX1, aY1) {
    var gradient = new CanvasGradient_('gradient');
    gradient.x0_ = aX0;
    gradient.y0_ = aY0;
    gradient.x1_ = aX1;
    gradient.y1_ = aY1;
    return gradient;
  };

  contextPrototype.createRadialGradient = function(aX0, aY0, aR0,
                                                   aX1, aY1, aR1) {
    var gradient = new CanvasGradient_('gradientradial');
    gradient.x0_ = aX0;
    gradient.y0_ = aY0;
    gradient.r0_ = aR0;
    gradient.x1_ = aX1;
    gradient.y1_ = aY1;
    gradient.r1_ = aR1;
    return gradient;
  };

  contextPrototype.drawImage = function(image, var_args) {
    var dx, dy, dw, dh, sx, sy, sw, sh;

    // to find the original width we overide the width and height
    var oldRuntimeWidth = image.runtimeStyle.width;
    var oldRuntimeHeight = image.runtimeStyle.height;
    image.runtimeStyle.width = 'auto';
    image.runtimeStyle.height = 'auto';

    // get the original size
    var w = image.width;
    var h = image.height;

    // and remove overides
    image.runtimeStyle.width = oldRuntimeWidth;
    image.runtimeStyle.height = oldRuntimeHeight;

    if (arguments.length == 3) {
      dx = arguments[1];
      dy = arguments[2];
      sx = sy = 0;
      sw = dw = w;
      sh = dh = h;
    } else if (arguments.length == 5) {
      dx = arguments[1];
      dy = arguments[2];
      dw = arguments[3];
      dh = arguments[4];
      sx = sy = 0;
      sw = w;
      sh = h;
    } else if (arguments.length == 9) {
      sx = arguments[1];
      sy = arguments[2];
      sw = arguments[3];
      sh = arguments[4];
      dx = arguments[5];
      dy = arguments[6];
      dw = arguments[7];
      dh = arguments[8];
    } else {
      throw Error('Invalid number of arguments');
    }

    var d = getCoords(this, dx, dy);

    var w2 = sw / 2;
    var h2 = sh / 2;

    var vmlStr = [];

    var W = 10;
    var H = 10;

    var scaleX = scaleY = 1;
    
    // For some reason that I've now forgotten, using divs didn't work
    vmlStr.push(' <g_vml_:group',
                ' coordsize="', Z * W, ',', Z * H, '"',
                ' coordorigin="0,0"' ,
                ' style="width:', W, 'px;height:', H, 'px;position:absolute;');

    // If filters are necessary (rotation exists), create them
    // filters are bog-slow, so only create them if abbsolutely necessary
    // The following check doesn't account for skews (which don't exist
    // in the canvas spec (yet) anyway.

    if (this.m_[0][0] != 1 || this.m_[0][1] ||
        this.m_[1][1] != 1 || this.m_[1][0]) {
      var filter = [];

     var scaleX = this.scaleX_;
     var scaleY = this.scaleY_;
      // Note the 12/21 reversal
      filter.push('M11=', this.m_[0][0] / scaleX, ',',
                  'M12=', this.m_[1][0] / scaleY, ',',
                  'M21=', this.m_[0][1] / scaleX, ',',
                  'M22=', this.m_[1][1] / scaleY, ',',
                  'Dx=', mr(d.x / Z), ',',
                  'Dy=', mr(d.y / Z), '');

      // Bounding box calculation (need to minimize displayed area so that
      // filters don't waste time on unused pixels.
      var max = d;
      var c2 = getCoords(this, dx + dw, dy);
      var c3 = getCoords(this, dx, dy + dh);
      var c4 = getCoords(this, dx + dw, dy + dh);

      max.x = m.max(max.x, c2.x, c3.x, c4.x);
      max.y = m.max(max.y, c2.y, c3.y, c4.y);

      vmlStr.push('padding:0 ', mr(max.x / Z), 'px ', mr(max.y / Z),
                  'px 0;filter:progid:DXImageTransform.Microsoft.Matrix(',
                  filter.join(''), ", SizingMethod='clip');");

    } else {
      vmlStr.push('top:', mr(d.y / Z), 'px;left:', mr(d.x / Z), 'px;');
    }

    vmlStr.push(' ">');

    // Draw a special cropping div if needed
    if (sx || sy) {
      // Apply scales to width and height
      vmlStr.push('<div style="overflow: hidden; width:', Math.ceil((dw + sx * dw / sw) * scaleX), 'px;',
                  ' height:', Math.ceil((dh + sy * dh / sh) * scaleY), 'px;',
                  ' filter:progid:DxImageTransform.Microsoft.Matrix(Dx=',
                  -sx * dw / sw * scaleX, ',Dy=', -sy * dh / sh * scaleY, ');">');
    }
    
      
    // Apply scales to width and height
    vmlStr.push('<div style="width:', Math.round(scaleX * w * dw / sw), 'px;',
                ' height:', Math.round(scaleY * h * dh / sh), 'px;',
                ' filter:');
   
    // If there is a globalAlpha, apply it to image
    if(this.globalAlpha < 1) {
      vmlStr.push(' progid:DXImageTransform.Microsoft.Alpha(opacity=' + (this.globalAlpha * 100) + ')');
    }
    
    vmlStr.push(' progid:DXImageTransform.Microsoft.AlphaImageLoader(src=', image.src, ',sizingMethod=scale)">');
    
    // Close the crop div if necessary            
    if (sx || sy) vmlStr.push('</div>');
    
    vmlStr.push('</div></div>');
    
    this.element_.insertAdjacentHTML('BeforeEnd', vmlStr.join(''));
  };

  contextPrototype.stroke = function(aFill) {
    var lineStr = [];
    var lineOpen = false;

    var W = 10;
    var H = 10;

    lineStr.push('<g_vml_:shape',
                 ' filled="', !!aFill, '"',
                 ' style="position:absolute;width:', W, 'px;height:', H, 'px;"',
                 ' coordorigin="0,0"',
                 ' coordsize="', Z * W, ',', Z * H, '"',
                 ' stroked="', !aFill, '"',
                 ' path="');

    var newSeq = false;
    var min = {x: null, y: null};
    var max = {x: null, y: null};

    for (var i = 0; i < this.currentPath_.length; i++) {
      var p = this.currentPath_[i];
      var c;

      switch (p.type) {
        case 'moveTo':
          c = p;
          lineStr.push(' m ', mr(p.x), ',', mr(p.y));
          break;
        case 'lineTo':
          lineStr.push(' l ', mr(p.x), ',', mr(p.y));
          break;
        case 'close':
          lineStr.push(' x ');
          p = null;
          break;
        case 'bezierCurveTo':
          lineStr.push(' c ',
                       mr(p.cp1x), ',', mr(p.cp1y), ',',
                       mr(p.cp2x), ',', mr(p.cp2y), ',',
                       mr(p.x), ',', mr(p.y));
          break;
        case 'at':
        case 'wa':
          lineStr.push(' ', p.type, ' ',
                       mr(p.x - this.scaleX_ * p.radius), ',',
                       mr(p.y - this.scaleY_ * p.radius), ' ',
                       mr(p.x + this.scaleX_ * p.radius), ',',
                       mr(p.y + this.scaleY_ * p.radius), ' ',
                       mr(p.xStart), ',', mr(p.yStart), ' ',
                       mr(p.xEnd), ',', mr(p.yEnd));
          break;
      }


      // TODO: Following is broken for curves due to
      //       move to proper paths.

      // Figure out dimensions so we can do gradient fills
      // properly
      if (p) {
        if (min.x == null || p.x < min.x) {
          min.x = p.x;
        }
        if (max.x == null || p.x > max.x) {
          max.x = p.x;
        }
        if (min.y == null || p.y < min.y) {
          min.y = p.y;
        }
        if (max.y == null || p.y > max.y) {
          max.y = p.y;
        }
      }
    }
    lineStr.push(' ">');

    if (!aFill) {
      appendStroke(this, lineStr);
    } else {
      appendFill(this, lineStr, min, max);
    }

    lineStr.push('</g_vml_:shape>');

    this.element_.insertAdjacentHTML('beforeEnd', lineStr.join(''));
  };

  function appendStroke(ctx, lineStr) {
    var a = processStyle(ctx.strokeStyle);
    var color = a.color;
    var opacity = a.alpha * ctx.globalAlpha;
    var lineWidth = ctx.lineScale_ * ctx.lineWidth;

    // VML cannot correctly render a line if the width is less than 1px.
    // In that case, we dilute the color to make the line look thinner.
    if (lineWidth < 1) {
      opacity *= lineWidth;
    }

    lineStr.push(
      '<g_vml_:stroke',
      ' opacity="', opacity, '"',
      ' joinstyle="', ctx.lineJoin, '"',
      ' miterlimit="', ctx.miterLimit, '"',
      ' endcap="', processLineCap(ctx.lineCap), '"',
      ' weight="', lineWidth, 'px"',
      ' color="', color, '" />'
    );
  }

  function appendFill(ctx, lineStr, min, max) {
    var fillStyle = ctx.fillStyle;
    var arcScaleX = ctx.scaleX_;
    var arcScaleY = ctx.scaleY_;
    var width = max.x - min.x;
    var height = max.y - min.y;
    if (fillStyle instanceof CanvasGradient_) {
      // TODO: Gradients transformed with the transformation matrix.
      var angle = 0;
      var focus = {x: 0, y: 0};

      // additional offset
      var shift = 0;
      // scale factor for offset
      var expansion = 1;

      if (fillStyle.type_ == 'gradient') {
        var x0 = fillStyle.x0_ / arcScaleX;
        var y0 = fillStyle.y0_ / arcScaleY;
        var x1 = fillStyle.x1_ / arcScaleX;
        var y1 = fillStyle.y1_ / arcScaleY;
        var p0 = getCoords(ctx, x0, y0);
        var p1 = getCoords(ctx, x1, y1);
        var dx = p1.x - p0.x;
        var dy = p1.y - p0.y;
        angle = Math.atan2(dx, dy) * 180 / Math.PI;

        // The angle should be a non-negative number.
        if (angle < 0) {
          angle += 360;
        }

        // Very small angles produce an unexpected result because they are
        // converted to a scientific notation string.
        if (angle < 1e-6) {
          angle = 0;
        }
      } else {
        var p0 = getCoords(ctx, fillStyle.x0_, fillStyle.y0_);
        focus = {
          x: (p0.x - min.x) / width,
          y: (p0.y - min.y) / height
        };

        width  /= arcScaleX * Z;
        height /= arcScaleY * Z;
        var dimension = m.max(width, height);
        shift = 2 * fillStyle.r0_ / dimension;
        expansion = 2 * fillStyle.r1_ / dimension - shift;
      }

      // We need to sort the color stops in ascending order by offset,
      // otherwise IE won't interpret it correctly.
      var stops = fillStyle.colors_;
      stops.sort(function(cs1, cs2) {
        return cs1.offset - cs2.offset;
      });

      var length = stops.length;
      var color1 = stops[0].color;
      var color2 = stops[length - 1].color;
      var opacity1 = stops[0].alpha * ctx.globalAlpha;
      var opacity2 = stops[length - 1].alpha * ctx.globalAlpha;

      var colors = [];
      for (var i = 0; i < length; i++) {
        var stop = stops[i];
        colors.push(stop.offset * expansion + shift + ' ' + stop.color);
      }

      // When colors attribute is used, the meanings of opacity and o:opacity2
      // are reversed.
      lineStr.push('<g_vml_:fill type="', fillStyle.type_, '"',
                   ' method="none" focus="100%"',
                   ' color="', color1, '"',
                   ' color2="', color2, '"',
                   ' colors="', colors.join(','), '"',
                   ' opacity="', opacity2, '"',
                   ' g_o_:opacity2="', opacity1, '"',
                   ' angle="', angle, '"',
                   ' focusposition="', focus.x, ',', focus.y, '" />');
    } else if (fillStyle instanceof CanvasPattern_) {
      if (width && height) {
        var deltaLeft = -min.x;
        var deltaTop = -min.y;
        lineStr.push('<g_vml_:fill',
                     ' position="',
                     deltaLeft / width * arcScaleX * arcScaleX, ',',
                     deltaTop / height * arcScaleY * arcScaleY, '"',
                     ' type="tile"',
                     // TODO: Figure out the correct size to fit the scale.
                     //' size="', w, 'px ', h, 'px"',
                     ' src="', fillStyle.src_, '" />');
       }
    } else {
      var a = processStyle(ctx.fillStyle);
      var color = a.color;
      var opacity = a.alpha * ctx.globalAlpha;
      lineStr.push('<g_vml_:fill color="', color, '" opacity="', opacity,
                   '" />');
    }
  }

  contextPrototype.fill = function() {
    this.stroke(true);
  };

  contextPrototype.closePath = function() {
    this.currentPath_.push({type: 'close'});
  };

  function getCoords(ctx, aX, aY) {
    var m = ctx.m_;
    return {
      x: Z * (aX * m[0][0] + aY * m[1][0] + m[2][0]) - Z2,
      y: Z * (aX * m[0][1] + aY * m[1][1] + m[2][1]) - Z2
    };
  };

  contextPrototype.save = function() {
    var o = {};
    copyState(this, o);
    this.aStack_.push(o);
    this.mStack_.push(this.m_);
    this.m_ = matrixMultiply(createMatrixIdentity(), this.m_);
  };

  contextPrototype.restore = function() {
    if (this.aStack_.length) {
      copyState(this.aStack_.pop(), this);
      this.m_ = this.mStack_.pop();
    }
  };

  function matrixIsFinite(m) {
    return isFinite(m[0][0]) && isFinite(m[0][1]) &&
        isFinite(m[1][0]) && isFinite(m[1][1]) &&
        isFinite(m[2][0]) && isFinite(m[2][1]);
  }

  function setM(ctx, m, updateLineScale) {
    if (!matrixIsFinite(m)) {
      return;
    }
    ctx.m_ = m;

    ctx.scaleX_ = Math.sqrt(m[0][0] * m[0][0] + m[0][1] * m[0][1]);
    ctx.scaleY_ = Math.sqrt(m[1][0] * m[1][0] + m[1][1] * m[1][1]);

    if (updateLineScale) {
      // Get the line scale.
      // Determinant of this.m_ means how much the area is enlarged by the
      // transformation. So its square root can be used as a scale factor
      // for width.
      var det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
      ctx.lineScale_ = sqrt(abs(det));
    }
  }

  contextPrototype.translate = function(aX, aY) {
    var m1 = [
      [1,  0,  0],
      [0,  1,  0],
      [aX, aY, 1]
    ];

    setM(this, matrixMultiply(m1, this.m_), false);
  };

  contextPrototype.rotate = function(aRot) {
    var c = mc(aRot);
    var s = ms(aRot);

    var m1 = [
      [c,  s, 0],
      [-s, c, 0],
      [0,  0, 1]
    ];

    setM(this, matrixMultiply(m1, this.m_), false);
  };

  contextPrototype.scale = function(aX, aY) {
    var m1 = [
      [aX, 0,  0],
      [0,  aY, 0],
      [0,  0,  1]
    ];

    setM(this, matrixMultiply(m1, this.m_), true);
  };

  contextPrototype.transform = function(m11, m12, m21, m22, dx, dy) {
    var m1 = [
      [m11, m12, 0],
      [m21, m22, 0],
      [dx,  dy,  1]
    ];

    setM(this, matrixMultiply(m1, this.m_), true);

  };

  contextPrototype.setTransform = function(m11, m12, m21, m22, dx, dy) {
    var m = [
      [m11, m12, 0],
      [m21, m22, 0],
      [dx,  dy,  1]
    ];

    setM(this, m, true);
  };

  /**
   * The text drawing function.
   * The maxWidth argument isn't taken in account, since no browser supports
   * it yet.
   */
  contextPrototype.drawText_ = function(text, x, y, maxWidth, stroke) {
    var m = this.m_,
        delta = 1000,
        left = 0,
        right = delta,
        offset = {x: 0, y: 0},
        lineStr = [];

    var fontStyle = getComputedStyle(processFontStyle(this.font),
                                     this.element_);

    var fontStyleString = buildStyle(fontStyle);

    var elementStyle = this.element_.currentStyle;
    var textAlign = this.textAlign.toLowerCase();
    switch (textAlign) {
      case 'left':
      case 'center':
      case 'right':
        break;
      case 'end':
        textAlign = elementStyle.direction == 'ltr' ? 'right' : 'left';
        break;
      case 'start':
        textAlign = elementStyle.direction == 'rtl' ? 'right' : 'left';
        break;
      default:
        textAlign = 'left';
    }

    // 1.75 is an arbitrary number, as there is no info about the text baseline
    switch (this.textBaseline) {
      case 'hanging':
      case 'top':
        offset.y = fontStyle.size / 1.75;
        break;
      case 'middle':
        break;
      default:
      case null:
      case 'alphabetic':
      case 'ideographic':
      case 'bottom':
        offset.y = -fontStyle.size / 2.25;
        break;
    }

    switch(textAlign) {
      case 'right':
        left = delta;
        right = 0.05;
        break;
      case 'center':
        left = right = delta / 2;
        break;
    }

    var d = getCoords(this, x + offset.x, y + offset.y);

    lineStr.push('<g_vml_:line from="', -left ,' 0" to="', right ,' 0.05" ',
                 ' coordsize="100 100" coordorigin="0 0"',
                 ' filled="', !stroke, '" stroked="', !!stroke,
                 '" style="position:absolute;width:1px;height:1px;">');

    if (stroke) {
      appendStroke(this, lineStr);
    } else {
      // TODO: Fix the min and max params.
      appendFill(this, lineStr, {x: -left, y: 0},
                 {x: right, y: fontStyle.size});
    }

    var skewM = m[0][0].toFixed(3) + ',' + m[1][0].toFixed(3) + ',' +
                m[0][1].toFixed(3) + ',' + m[1][1].toFixed(3) + ',0,0';

    var skewOffset = mr(d.x / Z) + ',' + mr(d.y / Z);

    lineStr.push('<g_vml_:skew on="t" matrix="', skewM ,'" ',
                 ' offset="', skewOffset, '" origin="', left ,' 0" />',
                 '<g_vml_:path textpathok="true" />',
                 '<g_vml_:textpath on="true" string="',
                 encodeHtmlAttribute(text),
                 '" style="v-text-align:', textAlign,
                 ';font:', encodeHtmlAttribute(fontStyleString),
                 '" /></g_vml_:line>');

    this.element_.insertAdjacentHTML('beforeEnd', lineStr.join(''));
  };

  contextPrototype.fillText = function(text, x, y, maxWidth) {
    this.drawText_(text, x, y, maxWidth, false);
  };

  contextPrototype.strokeText = function(text, x, y, maxWidth) {
    this.drawText_(text, x, y, maxWidth, true);
  };

  contextPrototype.measureText = function(text) {
    if (!this.textMeasureEl_) {
      var s = '<span style="position:absolute;' +
          'top:-20000px;left:0;padding:0;margin:0;border:none;' +
          'white-space:pre;"></span>';
      this.element_.insertAdjacentHTML('beforeEnd', s);
      this.textMeasureEl_ = this.element_.lastChild;
    }
    var doc = this.element_.ownerDocument;
    this.textMeasureEl_.innerHTML = '';
    try {
        this.textMeasureEl_.style.font = this.font;
    } catch (ex) {
        // Ignore failures to set to invalid font.
    }
    
    // Don't use innerHTML or innerText because they allow markup/whitespace.
    this.textMeasureEl_.appendChild(doc.createTextNode(text));
    return {width: this.textMeasureEl_.offsetWidth};
  };

  /******** STUBS ********/
  contextPrototype.clip = function() {
    // TODO: Implement
  };

  contextPrototype.arcTo = function() {
    // TODO: Implement
  };

  contextPrototype.createPattern = function(image, repetition) {
    return new CanvasPattern_(image, repetition);
  };

  // Gradient / Pattern Stubs
  function CanvasGradient_(aType) {
    this.type_ = aType;
    this.x0_ = 0;
    this.y0_ = 0;
    this.r0_ = 0;
    this.x1_ = 0;
    this.y1_ = 0;
    this.r1_ = 0;
    this.colors_ = [];
  }

  CanvasGradient_.prototype.addColorStop = function(aOffset, aColor) {
    aColor = processStyle(aColor);
    this.colors_.push({offset: aOffset,
                       color: aColor.color,
                       alpha: aColor.alpha});
  };

  function CanvasPattern_(image, repetition) {
    assertImageIsValid(image);
    switch (repetition) {
      case 'repeat':
      case null:
      case '':
        this.repetition_ = 'repeat';
        break
      case 'repeat-x':
      case 'repeat-y':
      case 'no-repeat':
        this.repetition_ = repetition;
        break;
      default:
        throwException('SYNTAX_ERR');
    }

    this.src_ = image.src;
    this.width_ = image.width;
    this.height_ = image.height;
  }

  function throwException(s) {
    throw new DOMException_(s);
  }

  function assertImageIsValid(img) {
    if (!img || img.nodeType != 1 || img.tagName != 'IMG') {
      throwException('TYPE_MISMATCH_ERR');
    }
    if (img.readyState != 'complete') {
      throwException('INVALID_STATE_ERR');
    }
  }

  function DOMException_(s) {
    this.code = this[s];
    this.message = s +': DOM Exception ' + this.code;
  }
  var p = DOMException_.prototype = new Error;
  p.INDEX_SIZE_ERR = 1;
  p.DOMSTRING_SIZE_ERR = 2;
  p.HIERARCHY_REQUEST_ERR = 3;
  p.WRONG_DOCUMENT_ERR = 4;
  p.INVALID_CHARACTER_ERR = 5;
  p.NO_DATA_ALLOWED_ERR = 6;
  p.NO_MODIFICATION_ALLOWED_ERR = 7;
  p.NOT_FOUND_ERR = 8;
  p.NOT_SUPPORTED_ERR = 9;
  p.INUSE_ATTRIBUTE_ERR = 10;
  p.INVALID_STATE_ERR = 11;
  p.SYNTAX_ERR = 12;
  p.INVALID_MODIFICATION_ERR = 13;
  p.NAMESPACE_ERR = 14;
  p.INVALID_ACCESS_ERR = 15;
  p.VALIDATION_ERR = 16;
  p.TYPE_MISMATCH_ERR = 17;

  // set up externs
  G_vmlCanvasManager = G_vmlCanvasManager_;
  CanvasRenderingContext2D = CanvasRenderingContext2D_;
  CanvasGradient = CanvasGradient_;
  CanvasPattern = CanvasPattern_;
  DOMException = DOMException_;
})();

} // if
else { // make the canvas test simple by kener.linfeng@gmail.com
    G_vmlCanvasManager = false;
}
return G_vmlCanvasManager;
});
define('zrender/shape/Sector', ['require', '../tool/math', '../tool/computeBoundingBox', '../tool/vector', './Base', '../tool/util'], function (require) {

        var math = require('../tool/math');
        var computeBoundingBox = require('../tool/computeBoundingBox');
        var vec2 = require('../tool/vector');
        var Base = require('./Base');
        
        var min0 = vec2.create();
        var min1 = vec2.create();
        var max0 = vec2.create();
        var max1 = vec2.create();
        /**
         * @alias module:zrender/shape/Sector
         * @constructor
         * @extends module:zrender/shape/Base
         * @param {Object} options
         */
        var Sector = function (options) {
            Base.call(this, options);
            /**
             * 扇形绘制样式
             * @name module:zrender/shape/Sector#style
             * @type {module:zrender/shape/Sector~ISectorStyle}
             */
            /**
             * 扇形高亮绘制样式
             * @name module:zrender/shape/Sector#highlightStyle
             * @type {module:zrender/shape/Sector~ISectorStyle}
             */
        };

        Sector.prototype = {
            type: 'sector',

            /**
             * 创建扇形路径
             * @param {CanvasRenderingContext2D} ctx
             * @param {module:zrender/shape/Sector~ISectorStyle} style
             */
            buildPath : function (ctx, style) {
                var x = style.x;   // 圆心x
                var y = style.y;   // 圆心y
                var r0 = style.r0 || 0;     // 形内半径[0,r)
                var r = style.r;            // 扇形外半径(0,r]
                var startAngle = style.startAngle;          // 起始角度[0,360)
                var endAngle = style.endAngle;              // 结束角度(0,360]
                var clockWise = style.clockWise || false;

                startAngle = math.degreeToRadian(startAngle);
                endAngle = math.degreeToRadian(endAngle);

                if (!clockWise) {
                    // 扇形默认是逆时针方向，Y轴向上
                    // 这个跟arc的标准不一样，为了兼容echarts
                    startAngle = -startAngle;
                    endAngle = -endAngle;
                }

                var unitX = math.cos(startAngle);
                var unitY = math.sin(startAngle);
                ctx.moveTo(
                    unitX * r0 + x,
                    unitY * r0 + y
                );

                ctx.lineTo(
                    unitX * r + x,
                    unitY * r + y
                );

                ctx.arc(x, y, r, startAngle, endAngle, !clockWise);

                ctx.lineTo(
                    math.cos(endAngle) * r0 + x,
                    math.sin(endAngle) * r0 + y
                );

                if (r0 !== 0) {
                    ctx.arc(x, y, r0, endAngle, startAngle, clockWise);
                }

                ctx.closePath();

                return;
            },

            /**
             * 返回扇形包围盒矩形
             * @param {module:zrender/shape/Sector~ISectorStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function (style) {
                if (style.__rect) {
                    return style.__rect;
                }
                
                var x = style.x;   // 圆心x
                var y = style.y;   // 圆心y
                var r0 = style.r0 || 0;     // 形内半径[0,r)
                var r = style.r;            // 扇形外半径(0,r]
                var startAngle = math.degreeToRadian(style.startAngle);
                var endAngle = math.degreeToRadian(style.endAngle);
                var clockWise = style.clockWise;

                if (!clockWise) {
                    startAngle = -startAngle;
                    endAngle = -endAngle;
                }

                if (r0 > 1) {
                    computeBoundingBox.arc(
                        x, y, r0, startAngle, endAngle, !clockWise, min0, max0
                    );   
                } else {
                    min0[0] = max0[0] = x;
                    min0[1] = max0[1] = y;
                }
                computeBoundingBox.arc(
                    x, y, r, startAngle, endAngle, !clockWise, min1, max1
                );

                vec2.min(min0, min0, min1);
                vec2.max(max0, max0, max1);
                style.__rect = {
                    x: min0[0],
                    y: min0[1],
                    width: max0[0] - min0[0],
                    height: max0[1] - min0[1]
                };
                return style.__rect;
            }
        };


        require('../tool/util').inherits(Sector, Base);
        return Sector;
    });
define('echarts/util/shape/Icon', ['require', 'zrender/tool/util', 'zrender/shape/Star', 'zrender/shape/Heart', 'zrender/shape/Droplet', 'zrender/shape/Image', 'zrender/shape/Base'], function (require) {
    var zrUtil = require('zrender/tool/util');
    
    function _iconMark(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;
        var dy = style.height / 16;
        ctx.moveTo(x,                 y + style.height);
        ctx.lineTo(x + 5 * dx,        y + 14 * dy);
        ctx.lineTo(x + style.width,   y + 3 * dy);
        ctx.lineTo(x + 13 * dx,       y);
        ctx.lineTo(x + 2 * dx,        y + 11 * dy);
        ctx.lineTo(x,                 y + style.height);

        ctx.moveTo(x + 6 * dx,        y + 10 * dy);
        ctx.lineTo(x + 14 * dx,       y + 2 * dy);

        ctx.moveTo(x + 10 * dx,       y + 13 * dy);
        ctx.lineTo(x + style.width,   y + 13 * dy);

        ctx.moveTo(x + 13 * dx,       y + 10 * dy);
        ctx.lineTo(x + 13 * dx,       y + style.height);
    }

    function _iconMarkUndo(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;
        var dy = style.height / 16;
        ctx.moveTo(x,                 y + style.height);
        ctx.lineTo(x + 5 * dx,        y + 14 * dy);
        ctx.lineTo(x + style.width,   y + 3 * dy);
        ctx.lineTo(x + 13 * dx,       y);
        ctx.lineTo(x + 2 * dx,        y + 11 * dy);
        ctx.lineTo(x,                 y + style.height);

        ctx.moveTo(x + 6 * dx,        y + 10 * dy);
        ctx.lineTo(x + 14 * dx,       y + 2 * dy);

        ctx.moveTo(x + 10 * dx,       y + 13 * dy);
        ctx.lineTo(x + style.width,   y + 13 * dy);
    }

    function _iconMarkClear(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;
        var dy = style.height / 16;

        ctx.moveTo(x + 4 * dx,        y + 15 * dy);
        ctx.lineTo(x + 9 * dx,        y + 13 * dy);
        ctx.lineTo(x + 14 * dx,       y + 8 * dy);
        ctx.lineTo(x + 11 * dx,       y + 5 * dy);
        ctx.lineTo(x + 6 * dx,        y + 10 * dy);
        ctx.lineTo(x + 4 * dx,        y + 15 * dy);

        ctx.moveTo(x + 5 * dx,        y);
        ctx.lineTo(x + 11 * dx,       y);
        ctx.moveTo(x + 5 * dx,        y + dy);
        ctx.lineTo(x + 11 * dx,       y + dy);
        ctx.moveTo(x,                 y + 2 * dy);
        ctx.lineTo(x + style.width,   y + 2 * dy);

        ctx.moveTo(x,                 y + 5 * dy);
        ctx.lineTo(x + 3 * dx,        y + style.height);
        ctx.lineTo(x + 13 * dx,       y + style.height);
        ctx.lineTo(x + style.width,   y + 5 * dy);
    }

    function _iconDataZoom(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;
        var dy = style.height / 16;

        ctx.moveTo(x,               y + 3 * dy);
        ctx.lineTo(x + 6 * dx,      y + 3 * dy);
        
        ctx.moveTo(x + 3 * dx,      y);
        ctx.lineTo(x + 3 * dx,      y + 6 * dy);

        ctx.moveTo(x + 3 * dx,      y + 8 * dy);
        ctx.lineTo(x + 3 * dx,      y + style.height);
        ctx.lineTo(x + style.width, y + style.height);
        ctx.lineTo(x + style.width, y + 3 * dy);
        ctx.lineTo(x + 8 * dx,      y + 3 * dy);
    }
    
    function _iconDataZoomReset(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;
        var dy = style.height / 16;

        ctx.moveTo(x + 6 * dx,      y);
        ctx.lineTo(x + 2 * dx,      y + 3 * dy);
        ctx.lineTo(x + 6 * dx,      y + 6 * dy);
        
        ctx.moveTo(x + 2 * dx,      y + 3 * dy);
        ctx.lineTo(x + 14 * dx,     y + 3 * dy);
        ctx.lineTo(x + 14 * dx,     y + 11 * dy);
        
        ctx.moveTo(x + 2 * dx,      y + 5 * dy);
        ctx.lineTo(x + 2 * dx,      y + 13 * dy);
        ctx.lineTo(x + 14 * dx,     y + 13 * dy);
        
        ctx.moveTo(x + 10 * dx,     y + 10 * dy);
        ctx.lineTo(x + 14 * dx,     y + 13 * dy);
        ctx.lineTo(x + 10 * dx,     y + style.height);
    }
    
    function _iconRestore(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;
        var dy = style.height / 16;
        var r = style.width / 2;
        
        ctx.lineWidth = 1.5;

        ctx.arc(x + r, y + r, r - dx, 0, Math.PI * 2 / 3);
        ctx.moveTo(x + 3 * dx,        y + style.height);
        ctx.lineTo(x + 0 * dx,        y + 12 * dy);
        ctx.lineTo(x + 5 * dx,        y + 11 * dy);

        ctx.moveTo(x, y + 8 * dy);
        ctx.arc(x + r, y + r, r - dx, Math.PI, Math.PI * 5 / 3);
        ctx.moveTo(x + 13 * dx,       y);
        ctx.lineTo(x + style.width,   y + 4 * dy);
        ctx.lineTo(x + 11 * dx,       y + 5 * dy);
    }

    function _iconLineChart(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;
        var dy = style.height / 16;

        ctx.moveTo(x, y);
        ctx.lineTo(x, y + style.height);
        ctx.lineTo(x + style.width, y + style.height);

        ctx.moveTo(x + 2 * dx,    y + 14 * dy);
        ctx.lineTo(x + 7 * dx,    y + 6 * dy);
        ctx.lineTo(x + 11 * dx,   y + 11 * dy);
        ctx.lineTo(x + 15 * dx,   y + 2 * dy);
    }

    function _iconBarChart(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;
        var dy = style.height / 16;

        ctx.moveTo(x, y);
        ctx.lineTo(x, y + style.height);
        ctx.lineTo(x + style.width, y + style.height);

        ctx.moveTo(x + 3 * dx,        y + 14 * dy);
        ctx.lineTo(x + 3 * dx,        y + 6 * dy);
        ctx.lineTo(x + 4 * dx,        y + 6 * dy);
        ctx.lineTo(x + 4 * dx,        y + 14 * dy);
        ctx.moveTo(x + 7 * dx,        y + 14 * dy);
        ctx.lineTo(x + 7 * dx,        y + 2 * dy);
        ctx.lineTo(x + 8 * dx,        y + 2 * dy);
        ctx.lineTo(x + 8 * dx,        y + 14 * dy);
        ctx.moveTo(x + 11 * dx,       y + 14 * dy);
        ctx.lineTo(x + 11 * dx,       y + 9 * dy);
        ctx.lineTo(x + 12 * dx,       y + 9 * dy);
        ctx.lineTo(x + 12 * dx,       y + 14 * dy);
    }
    
    function _iconPieChart(ctx, style) {
        var x = style.x;
        var y = style.y;
        var width = style.width - 2;
        var height = style.height - 2;
        var r = Math.min(width, height) / 2;
        y += 2;
        ctx.moveTo(x + r + 3, y + r - 3);
        ctx.arc(x + r + 3, y + r - 3, r - 1, 0, -Math.PI / 2, true);
        ctx.lineTo(x + r + 3, y + r - 3);
      
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + r, y + r);
        ctx.arc(x + r, y + r, r, -Math.PI / 2, Math.PI * 2, true);
        ctx.lineTo(x + r, y + r);
        ctx.lineWidth = 1.5;
    }
    
    function _iconFunnelChart(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;
        var dy = style.height / 16;
        y -= dy;
        ctx.moveTo(x + 1 * dx,      y + 2 * dy);
        ctx.lineTo(x + 15 * dx,     y + 2 * dy);
        ctx.lineTo(x + 14 * dx,     y + 3 * dy);
        ctx.lineTo(x + 2 * dx,      y + 3 * dy);
        
        ctx.moveTo(x + 3 * dx,      y + 6 * dy);
        ctx.lineTo(x + 13 * dx,     y + 6 * dy);
        ctx.lineTo(x + 12 * dx,     y + 7 * dy);
        ctx.lineTo(x + 4 * dx,      y + 7 * dy);
        
        ctx.moveTo(x + 5 * dx,      y + 10 * dy);
        ctx.lineTo(x + 11 * dx,      y + 10 * dy);
        ctx.lineTo(x + 10 * dx,      y + 11 * dy);
        ctx.lineTo(x + 6 * dx,      y + 11 * dy);
        
        ctx.moveTo(x + 7 * dx,      y + 14 * dy);
        ctx.lineTo(x + 9 * dx,      y + 14 * dy);
        ctx.lineTo(x + 8 * dx,      y + 15 * dy);
        ctx.lineTo(x + 7 * dx,      y + 15 * dy);
    }
    
    function _iconForceChart(ctx, style) {
        var x = style.x;
        var y = style.y;
        var width = style.width;
        var height = style.height;
        var dx = width / 16;
        var dy = height / 16;
        var r = Math.min(dx, dy) * 2;

        ctx.moveTo(x + dx + r, y + dy + r);
        ctx.arc(x + dx, y + dy, r, Math.PI / 4, Math.PI * 3);
        
        ctx.lineTo(x + 7 * dx - r, y + 6 * dy - r);
        ctx.arc(x + 7 * dx, y + 6 * dy, r, Math.PI / 4 * 5, Math.PI * 4);
        ctx.arc(x + 7 * dx, y + 6 * dy, r / 2, Math.PI / 4 * 5, Math.PI * 4);
        
        ctx.moveTo(x + 7 * dx - r / 2, y + 6 * dy + r);
        ctx.lineTo(x + dx + r, y + 14 * dy - r);
        ctx.arc(x + dx, y + 14 * dy, r, -Math.PI / 4, Math.PI * 2);
        
        ctx.moveTo(x + 7 * dx + r / 2, y + 6 * dy);
        ctx.lineTo(x + 14 * dx - r, y + 10 * dy - r / 2);
        ctx.moveTo(x + 16 * dx, y + 10 * dy);
        ctx.arc(x + 14 * dx, y + 10 * dy, r, 0, Math.PI * 3);
        ctx.lineWidth = 1.5;
    }
    
    function _iconChordChart(ctx, style) {
        var x = style.x;
        var y = style.y;
        var width = style.width;
        var height = style.height;
        var r = Math.min(width, height) / 2;

        ctx.moveTo(x + width, y + height / 2);
        ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
        
        ctx.arc(x + r, y, r, Math.PI / 4, Math.PI / 5 * 4);
        ctx.arc(x, y + r, r, -Math.PI / 3, Math.PI / 3);
        ctx.arc(x + width, y + height, r, Math.PI, Math.PI / 2 * 3);
        ctx.lineWidth = 1.5;
    }

    function _iconStackChart(ctx, style) {
        var x = style.x;
        var y = style.y;
        var width = style.width;
        var height = style.height;
        var dy = Math.round(height / 3);
        var delta = Math.round((dy - 2) / 2);
        var len = 3;
        while (len--) {
            ctx.rect(x, y + dy * len + delta, width, 2);
        }
    }
    
    function _iconTiledChart(ctx, style) {
        var x = style.x;
        var y = style.y;
        var width = style.width;
        var height = style.height;
        var dx = Math.round(width / 3);
        var delta = Math.round((dx - 2) / 2);
        var len = 3;
        while (len--) {
            ctx.rect(x + dx * len + delta, y, 2, height);
        }
    }
    
    function _iconDataView(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;

        ctx.moveTo(x + dx, y);
        ctx.lineTo(x + dx, y + style.height);
        ctx.lineTo(x + 15 * dx, y + style.height);
        ctx.lineTo(x + 15 * dx, y);
        ctx.lineTo(x + dx, y);

        ctx.moveTo(x + 3 * dx, y + 3 * dx);
        ctx.lineTo(x + 13 * dx, y + 3 * dx);

        ctx.moveTo(x + 3 * dx, y + 6 * dx);
        ctx.lineTo(x + 13 * dx, y + 6 * dx);

        ctx.moveTo(x + 3 * dx, y + 9 * dx);
        ctx.lineTo(x + 13 * dx, y + 9 * dx);

        ctx.moveTo(x + 3 * dx, y + 12 * dx);
        ctx.lineTo(x + 9 * dx, y + 12 * dx);
    }
    
    function _iconSave(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;
        var dy = style.height / 16;

        ctx.moveTo(x, y);
        ctx.lineTo(x, y + style.height);
        ctx.lineTo(x + style.width, y + style.height);
        ctx.lineTo(x + style.width, y);
        ctx.lineTo(x, y);

        ctx.moveTo(x + 4 * dx,    y);
        ctx.lineTo(x + 4 * dx,    y + 8 * dy);
        ctx.lineTo(x + 12 * dx,   y + 8 * dy);
        ctx.lineTo(x + 12 * dx,   y);
        
        ctx.moveTo(x + 6 * dx,    y + 11 * dy);
        ctx.lineTo(x + 6 * dx,    y + 13 * dy);
        ctx.lineTo(x + 10 * dx,   y + 13 * dy);
        ctx.lineTo(x + 10 * dx,   y + 11 * dy);
        ctx.lineTo(x + 6 * dx,    y + 11 * dy);
    }
    
    function _iconCross(ctx, style) {
        var x = style.x;
        var y = style.y;
        var width = style.width;
        var height = style.height;
        ctx.moveTo(x, y + height / 2);
        ctx.lineTo(x + width, y + height / 2);
        
        ctx.moveTo(x + width / 2, y);
        ctx.lineTo(x + width / 2, y + height);
    }
    
    function _iconCircle(ctx, style) {
        var width = style.width / 2;
        var height = style.height / 2;
        var r = Math.min(width, height);
        ctx.moveTo(
            style.x + width + r, 
            style.y + height
        );
        ctx.arc(
            style.x + width, 
            style.y + height, 
            r,
            0, 
            Math.PI * 2
        );
        ctx.closePath();
    }
    
    function _iconRectangle(ctx, style) {
        ctx.rect(style.x, style.y, style.width, style.height);
        ctx.closePath();
    }
    
    function _iconTriangle(ctx, style) {
        var width = style.width / 2;
        var height = style.height / 2;
        var x = style.x + width;
        var y = style.y + height;
        var symbolSize = Math.min(width, height);
        ctx.moveTo(x, y - symbolSize);
        ctx.lineTo(x + symbolSize, y + symbolSize);
        ctx.lineTo(x - symbolSize, y + symbolSize);
        ctx.lineTo(x, y - symbolSize);
        ctx.closePath();
    }
    
    function _iconDiamond(ctx, style) {
        var width = style.width / 2;
        var height = style.height / 2;
        var x = style.x + width;
        var y = style.y + height;
        var symbolSize = Math.min(width, height);
        ctx.moveTo(x, y - symbolSize);
        ctx.lineTo(x + symbolSize, y);
        ctx.lineTo(x, y + symbolSize);
        ctx.lineTo(x - symbolSize, y);
        ctx.lineTo(x, y - symbolSize);
        ctx.closePath();
    }
    
    function _iconArrow(ctx, style) {
        var x = style.x;
        var y = style.y;
        var dx = style.width / 16;
        ctx.moveTo(x + 8 * dx,  y);
        ctx.lineTo(x + dx,      y + style.height);
        ctx.lineTo(x + 8 * dx,  y + style.height / 4 * 3);
        ctx.lineTo(x + 15 * dx, y + style.height);
        ctx.lineTo(x + 8 * dx,  y);
        ctx.closePath();
    }
    
    function _iconStar(ctx, style) {
        var StarShape = require('zrender/shape/Star');
        var width = style.width / 2;
        var height = style.height / 2;
        StarShape.prototype.buildPath(ctx, {
            x : style.x + width,
            y : style.y + height,
            r : Math.min(width, height),
            n : style.n || 5
        });
    }
    
    function _iconHeart(ctx, style) {
        var HeartShape = require('zrender/shape/Heart');
        HeartShape.prototype.buildPath(ctx, {
            x : style.x + style.width / 2,
            y : style.y + style.height * 0.2,
            a : style.width / 2,
            b : style.height * 0.8
        });
    }
    
    function _iconDroplet(ctx, style) {
        var DropletShape = require('zrender/shape/Droplet');
        DropletShape.prototype.buildPath(ctx, {
            x : style.x + style.width * 0.5,
            y : style.y + style.height * 0.5,
            a : style.width * 0.5,
            b : style.height * 0.8
        });
    }
    
    function _iconPin(ctx, style) {
        var x = style.x;
        var y = style.y - style.height / 2 * 1.5;
        var width = style.width / 2;
        var height = style.height / 2;
        var r = Math.min(width, height);
        ctx.arc(
            x + width, 
            y + height, 
            r,
            Math.PI / 5 * 4, 
            Math.PI / 5
        );
        ctx.lineTo(x + width, y + height + r * 1.5);
        ctx.closePath();
    }
    
    function _iconImage(ctx, style, refreshNextFrame) {
        var ImageShape = require('zrender/shape/Image');
        this._imageShape = this._imageShape || new ImageShape({
            style: {}
        });
        for (var name in style) {
            this._imageShape.style[name] = style[name];
        }
        this._imageShape.brush(ctx, false, refreshNextFrame);
    }
    
    var Base = require('zrender/shape/Base');
    
    function Icon(options) {
        Base.call(this, options);
    }

    Icon.prototype =  {
        type : 'icon',
        iconLibrary : {
            mark : _iconMark,
            markUndo : _iconMarkUndo,
            markClear : _iconMarkClear,
            dataZoom : _iconDataZoom,
            dataZoomReset : _iconDataZoomReset,
            restore : _iconRestore,
            lineChart : _iconLineChart,
            barChart : _iconBarChart,
            pieChart : _iconPieChart,
            funnelChart : _iconFunnelChart,
            forceChart : _iconForceChart,
            chordChart : _iconChordChart,
            stackChart : _iconStackChart,
            tiledChart : _iconTiledChart,
            dataView : _iconDataView,
            saveAsImage : _iconSave,
            
            cross : _iconCross,
            circle : _iconCircle,
            rectangle : _iconRectangle,
            triangle : _iconTriangle,
            diamond : _iconDiamond,
            arrow : _iconArrow,
            star : _iconStar,
            heart : _iconHeart,
            droplet : _iconDroplet,
            pin : _iconPin,
            image : _iconImage
        },
        brush: function (ctx, isHighlight, refreshNextFrame) {
            var style = isHighlight ? this.highlightStyle : this.style;
            style = style || {};
            var iconType = style.iconType || this.style.iconType;
            if (iconType === 'image') {
                var ImageShape = require('zrender/shape/Image');
                ImageShape.prototype.brush.call(this, ctx, isHighlight, refreshNextFrame);

            } else {

                var style = this.beforeBrush(ctx, isHighlight);

                ctx.beginPath();
                this.buildPath(ctx, style, refreshNextFrame);

                switch (style.brushType) {
                    /* jshint ignore:start */
                    case 'both':
                        ctx.fill();
                    case 'stroke':
                        style.lineWidth > 0 && ctx.stroke();
                        break;
                    /* jshint ignore:end */
                    default:
                        ctx.fill();
                }
                
                this.drawText(ctx, style, this.style);

                this.afterBrush(ctx);
            }
        },
        /**
         * 创建矩形路径
         * @param {Context2D} ctx Canvas 2D上下文
         * @param {Object} style 样式
         */
        buildPath : function (ctx, style, refreshNextFrame) {
            if (this.iconLibrary[style.iconType]) {
                this.iconLibrary[style.iconType].call(this, ctx, style, refreshNextFrame);
            }
            else {
                ctx.moveTo(style.x, style.y);
                ctx.lineTo(style.x + style.width, style.y);
                ctx.lineTo(style.x + style.width, style.y + style.height);
                ctx.lineTo(style.x, style.y + style.height);
                ctx.lineTo(style.x, style.y);
                ctx.closePath();
            }

            return;
        },

        /**
         * 返回矩形区域，用于局部刷新和文字定位
         * @param {Object} style
         */
        getRect : function (style) {
            if (style.__rect) {
                return style.__rect;
            }
            
            // pin比较特殊，让尖端在目标x,y上
            style.__rect = {
                x : Math.round(style.x),
                y : Math.round(style.y - (style.iconType == 'pin' 
                                         ? (style.height / 2 * 1.5) : 0)
                               ),
                width : style.width,
                height : style.height * (
                    style.iconType === 'pin' ? 1.25 : 1
                )
            };
            
            return style.__rect;
        },

        isCover : function (x, y) {
            var originPos = this.transformCoordToLocal(x, y);
            x = originPos[0];
            y = originPos[1];

            // 快速预判并保留判断矩形
            var rect = this.style.__rect;
            if (!rect) {
                rect = this.style.__rect = this.getRect(this.style);
            }
            // 提高交互体验，太小的图形包围盒四向扩大4px
            var delta = (rect.height < 8 || rect.width < 8 ) ? 4 : 0;
            return x >= rect.x - delta
                && x <= (rect.x + rect.width + delta)
                && y >= rect.y - delta
                && y <= (rect.y + rect.height + delta);
        }
    };

    zrUtil.inherits(Icon, Base);
    
    return Icon;
});
define('echarts/util/shape/MarkLine', ['require', 'zrender/shape/Base', './Icon', 'zrender/shape/Line', 'zrender/shape/BezierCurve', 'zrender/tool/area', 'zrender/shape/util/dashedLineTo', 'zrender/tool/util', 'zrender/tool/curve'], function (require) {
    var Base = require('zrender/shape/Base');
    var IconShape = require('./Icon');
    var LineShape = require('zrender/shape/Line');
    var lineInstance = new LineShape({});
    var CurveShape = require('zrender/shape/BezierCurve');
    var curveInstance = new CurveShape({});

    var area = require('zrender/tool/area');
    var dashedLineTo = require('zrender/shape/util/dashedLineTo');
    var zrUtil = require('zrender/tool/util');
    var curveTool = require('zrender/tool/curve');

    function MarkLine(options) {
        Base.call(this, options);

        if (this.style.curveness > 0) {
            this.updatePoints(this.style);
        }
        if (this.highlightStyle.curveness > 0) {
            this.updatePoints(this.highlightStyle);
        }
    }

    MarkLine.prototype =  {
        type : 'mark-line',
        /**
         * 画刷
         * @param ctx 画布句柄
         * @param isHighlight   是否为高亮状态
         * @param updateCallback 让painter更新视图，base.brush没用，需要的话重载brush
         */
        brush : function (ctx, isHighlight) {
            var style = this.style;

            if (isHighlight) {
                // 根据style扩展默认高亮样式
                style = this.getHighlightStyle(
                    style,
                    this.highlightStyle || {}
                );
            }

            ctx.save();
            this.setContext(ctx, style);

            // 设置transform
            this.setTransform(ctx);

            ctx.save();
            ctx.beginPath();
            this.buildPath(ctx, style);
            ctx.stroke();
            ctx.restore();

            this.brushSymbol(ctx, style, 0);
            this.brushSymbol(ctx, style, 1);

            this.drawText(ctx, style, this.style);

            ctx.restore();
        },

        /**
         * 创建线条路径
         * @param {Context2D} ctx Canvas 2D上下文
         * @param {Object} style 样式
         */
        buildPath : function (ctx, style) {
            var lineType = style.lineType || 'solid';

            ctx.moveTo(style.xStart, style.yStart);
            if (style.curveness > 0) {
                // FIXME Bezier 在少部分浏览器上暂时不支持虚线
                var lineDash = null;
                switch (lineType) {
                    case 'dashed':
                        lineDash = [5, 5];
                        break;
                    case'dotted':
                        lineDash = [1, 1];
                        break;
                }
                if (lineDash && ctx.setLineDash) {
                    ctx.setLineDash(lineDash);
                }
                
                ctx.quadraticCurveTo(
                    style.cpX1, style.cpY1, style.xEnd, style.yEnd
                );
            }
            else {
                if (lineType == 'solid') {
                    ctx.lineTo(style.xEnd, style.yEnd);
                }
                else {
                    var dashLength = (style.lineWidth || 1) 
                        * (style.lineType == 'dashed' ? 5 : 1);
                    dashedLineTo(
                        ctx, style.xStart, style.yStart,
                        style.xEnd, style.yEnd, dashLength
                    );
                }
            }
        },

        /**
         * Update cpX1 and cpY1 according to curveniss
         * @param  {Object} style
         */
        updatePoints: function (style) {
            var curveness = style.curveness || 0;
            var inv = 1;

            var x0 = style.xStart;
            var y0 = style.yStart;
            var x2 = style.xEnd;
            var y2 = style.yEnd;
            var x1 = (x0 + x2) / 2 - inv * (y0 - y2) * curveness;
            var y1 =(y0 + y2) / 2 - inv * (x2 - x0) * curveness;

            style.cpX1 = x1;
            style.cpY1 = y1;
        },

        /**
         * 标线始末标注
         */
        brushSymbol : function (ctx, style, idx) {
            if (style.symbol[idx] == 'none') {
                return;
            }
            ctx.save();
            ctx.beginPath();

            ctx.lineWidth = style.symbolBorder;
            ctx.strokeStyle = style.symbolBorderColor;
            // symbol
            var symbol = style.symbol[idx].replace('empty', '')
                                              .toLowerCase();
            if (style.symbol[idx].match('empty')) {
                ctx.fillStyle = '#fff'; //'rgba(0, 0, 0, 0)';
            }

            // symbolRotate
            var x0 = style.xStart;
            var y0 = style.yStart;
            var x2 = style.xEnd;
            var y2 = style.yEnd;
            var x = idx === 0 ? x0 : x2;
            var y = idx === 0 ? y0 : y2;
            var curveness = style.curveness || 0;
            var rotate = style.symbolRotate[idx] != null ? (style.symbolRotate[idx] - 0) : 0;
            rotate = rotate / 180 * Math.PI;

            if (symbol == 'arrow' && rotate === 0) {
                if (curveness === 0) {
                    var sign = idx === 0 ? -1 : 1; 
                    rotate = Math.PI / 2 + Math.atan2(
                        sign * (y2 - y0), sign * (x2 - x0)
                    );
                }
                else {
                    var x1 = style.cpX1;
                    var y1 = style.cpY1;

                    var quadraticDerivativeAt = curveTool.quadraticDerivativeAt;
                    var dx = quadraticDerivativeAt(x0, x1, x2, idx);
                    var dy = quadraticDerivativeAt(y0, y1, y2, idx);

                    rotate = Math.PI / 2 + Math.atan2(dy, dx);
                }
            }
            
            ctx.translate(x, y);

            if (rotate !== 0) {
                ctx.rotate(rotate);
            }

            // symbolSize
            var symbolSize = style.symbolSize[idx];
            IconShape.prototype.buildPath(ctx, {
                x: -symbolSize,
                y: -symbolSize,
                width: symbolSize * 2,
                height: symbolSize * 2,
                iconType: symbol
            });

            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        },

        /**
         * 返回矩形区域，用于局部刷新和文字定位
         * @param {Object} style
         */
        getRect : function (style) {
            style.curveness > 0 ? curveInstance.getRect(style)
                : lineInstance.getRect(style);
            return style.__rect;
        },

        isCover : function (x, y) {
            var originPos = this.transformCoordToLocal(x, y);
            x = originPos[0];
            y = originPos[1];

            // 快速预判并保留判断矩形
            if (this.isCoverRect(x, y)) {
                // 矩形内
                return this.style.curveness > 0
                       ? area.isInside(curveInstance, this.style, x, y)
                       : area.isInside(lineInstance, this.style, x, y);
            }

            return false;
        }
    };

    zrUtil.inherits(MarkLine, Base);

    return MarkLine;
});
define('echarts/util/shape/Symbol', ['require', 'zrender/shape/Base', 'zrender/shape/Polygon', 'zrender/tool/util', './normalIsCover'], function (require) {
    var Base = require('zrender/shape/Base');
    var PolygonShape = require('zrender/shape/Polygon');
    var polygonInstance = new PolygonShape({});
    var zrUtil = require('zrender/tool/util');

    function Symbol(options) {
        Base.call(this, options);
    }

    Symbol.prototype =  {
        type : 'symbol',
        /**
         * 创建矩形路径
         * @param {Context2D} ctx Canvas 2D上下文
         * @param {Object} style 样式
         */
        buildPath : function (ctx, style) {
            var pointList = style.pointList;
            var len = pointList.length;
            if (len === 0) {
                return;
            }

            var subSize = 10000;
            var subSetLength = Math.ceil(len / subSize);
            var sub;
            var subLen;
            var isArray = pointList[0] instanceof Array;
            var size = style.size ? style.size : 2;
            var curSize = size;
            var halfSize = size / 2;
            var PI2 = Math.PI * 2;
            var percent;
            var x;
            var y;
            for (var j = 0; j < subSetLength; j++) {
                ctx.beginPath();
                sub = j * subSize;
                subLen = sub + subSize;
                subLen = subLen > len ? len : subLen;
                for (var i = sub; i < subLen; i++) {
                    if (style.random) {
                        percent = style['randomMap' + (i % 20)] / 100;
                        curSize = size * percent * percent;
                        halfSize = curSize / 2;
                    }
                    if (isArray) {
                        x = pointList[i][0];
                        y = pointList[i][1];
                    }
                    else {
                        x = pointList[i].x;
                        y = pointList[i].y;
                    }
                    if (curSize < 3) {
                        // 小于3像素视觉误差
                        ctx.rect(x - halfSize, y - halfSize, curSize, curSize);
                    }
                    else {
                        // 大于3像素才考虑图形
                        switch (style.iconType) {
                            case 'circle' :
                                ctx.moveTo(x, y);
                                ctx.arc(x, y, halfSize, 0, PI2, true);
                                break;
                            case 'diamond' :
                                ctx.moveTo(x, y - halfSize);
                                ctx.lineTo(x + halfSize / 3, y - halfSize / 3);
                                ctx.lineTo(x + halfSize, y);
                                ctx.lineTo(x + halfSize / 3, y + halfSize / 3);
                                ctx.lineTo(x, y + halfSize);
                                ctx.lineTo(x - halfSize / 3, y + halfSize / 3);
                                ctx.lineTo(x - halfSize, y);
                                ctx.lineTo(x - halfSize / 3, y - halfSize / 3);
                                ctx.lineTo(x, y - halfSize);
                                break;
                            default :
                                ctx.rect(x - halfSize, y - halfSize, curSize, curSize);
                        }
                    }
                }
                ctx.closePath();
                if (j < (subSetLength - 1)) {
                    switch (style.brushType) {
                        case 'both':
                            ctx.fill();
                            style.lineWidth > 0 && ctx.stroke();  // js hint -_-"
                            break;
                        case 'stroke':
                            style.lineWidth > 0 && ctx.stroke();
                            break;
                        default:
                            ctx.fill();
                    }
                }
            }
        },

        /* 像素模式
        buildPath : function (ctx, style) {
            var pointList = style.pointList;
            var rect = this.getRect(style);
            var ratio = window.devicePixelRatio || 1;
            // console.log(rect)
            // var ti = new Date();
            // bbox取整
            rect = {
                x : Math.floor(rect.x),
                y : Math.floor(rect.y),
                width : Math.floor(rect.width),
                height : Math.floor(rect.height)
            };
            var pixels = ctx.getImageData(
                rect.x * ratio, rect.y * ratio,
                rect.width * ratio, rect.height * ratio
            );
            var data = pixels.data;
            var idx;
            var zrColor = require('zrender/tool/color');
            var color = zrColor.toArray(style.color);
            var r = color[0];
            var g = color[1];
            var b = color[2];
            var width = rect.width;

            for (var i = 1, l = pointList.length; i < l; i++) {
                idx = ((Math.floor(pointList[i][0]) - rect.x) * ratio
                       + (Math.floor(pointList[i][1])- rect.y) * width * ratio * ratio
                      ) * 4;
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = 255;
            }
            ctx.putImageData(pixels, rect.x * ratio, rect.y * ratio);
            // console.log(new Date() - ti);
            return;
        },
        */

        /**
         * 返回矩形区域，用于局部刷新和文字定位
         * @param {Object} style
         */
        getRect : function (style) {
            return style.__rect || polygonInstance.getRect(style);
        },

        isCover : require('./normalIsCover')
    };

    zrUtil.inherits(Symbol, Base);

    return Symbol;
});
define('zrender/shape/ShapeBundle', ['require', './Base', '../tool/util'], function (require) {

    var Base = require('./Base');

    var ShapeBundle = function (options) {
        Base.call(this, options);
        /**
         * ShapeBundle绘制样式
         * @name module:zrender/shape/ShapeBundle#style
         * @type {module:zrender/shape/ShapeBundle~IShapeBundleStyle}
         */
        /**
         * ShapeBundle高亮绘制样式
         * @name module:zrender/shape/ShapeBundle#highlightStyle
         * @type {module:zrender/shape/ShapeBundle~IShapeBundleStyle}
         */
    };

    ShapeBundle.prototype = {

        constructor: ShapeBundle,

        type: 'shape-bundle',

        brush: function (ctx, isHighlight) {
            var style = this.beforeBrush(ctx, isHighlight);

            ctx.beginPath();
            for (var i = 0; i < style.shapeList.length; i++) {
                var subShape = style.shapeList[i];
                var subShapeStyle = subShape.style;
                if (isHighlight) {
                    subShapeStyle = subShape.getHighlightStyle(
                        subShapeStyle,
                        subShape.highlightStyle || {},
                        subShape.brushTypeOnly
                    );
                }
                subShape.buildPath(ctx, subShapeStyle);
            }
            switch (style.brushType) {
                /* jshint ignore:start */
                case 'both':
                    ctx.fill();
                case 'stroke':
                    style.lineWidth > 0 && ctx.stroke();
                    break;
                /* jshint ignore:end */
                default:
                    ctx.fill();
            }

            this.drawText(ctx, style, this.style);

            this.afterBrush(ctx);
        },

        /**
         * 计算返回多边形包围盒矩阵
         * @param {module:zrender/shape/Polygon~IShapeBundleStyle} style
         * @return {module:zrender/shape/Base~IBoundingRect}
         */
        getRect: function (style) {
            if (style.__rect) {
                return style.__rect;
            }
            var minX = Infinity;
            var maxX = -Infinity;
            var minY = Infinity;
            var maxY = -Infinity;
            for (var i = 0; i < style.shapeList.length; i++) {
                var subShape = style.shapeList[i];
                // TODO Highlight style ?
                var subRect = subShape.getRect(subShape.style);

                var minX = Math.min(subRect.x, minX);
                var minY = Math.min(subRect.y, minY);
                var maxX = Math.max(subRect.x + subRect.width, maxX);
                var maxY = Math.max(subRect.y + subRect.height, maxY);
            }

            style.__rect = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
            };

            return style.__rect;
        },

        isCover: function (x, y) {
            var originPos = this.transformCoordToLocal(x, y);
            x = originPos[0];
            y = originPos[1];
            
            if (this.isCoverRect(x, y)) {
                for (var i = 0; i < this.style.shapeList.length; i++) {
                    var subShape = this.style.shapeList[i];
                    if (subShape.isCover(x, y)) {
                        return true;
                    }
                }
            }

            return false;
        }
    };

    require('../tool/util').inherits(ShapeBundle, Base);
    return ShapeBundle;
});
define('echarts/util/ecEffect', ['require', '../util/ecData', 'zrender/shape/Circle', 'zrender/shape/Image', 'zrender/tool/curve', '../util/shape/Icon', '../util/shape/Symbol', 'zrender/shape/ShapeBundle', 'zrender/shape/Polyline', 'zrender/tool/vector', 'zrender/tool/env'], function (require) {
    var ecData = require('../util/ecData');
    
    var CircleShape = require('zrender/shape/Circle');
    var ImageShape = require('zrender/shape/Image');
    var curveTool = require('zrender/tool/curve');
    var IconShape = require('../util/shape/Icon');
    var SymbolShape = require('../util/shape/Symbol');
    var ShapeBundle = require('zrender/shape/ShapeBundle');
    var Polyline = require('zrender/shape/Polyline');
    var vec2 = require('zrender/tool/vector');

    var canvasSupported = require('zrender/tool/env').canvasSupported;
    
    function point(zr, effectList, shape, zlevel) {
        var effect = shape.effect;
        var color = effect.color || shape.style.strokeColor || shape.style.color;
        var shadowColor = effect.shadowColor || color;
        var size = effect.scaleSize;
        var distance = effect.bounceDistance;
        var shadowBlur = typeof effect.shadowBlur != 'undefined'
                         ? effect.shadowBlur : size;

        var effectShape;
        if (shape.type !== 'image') {
            effectShape = new IconShape({
                zlevel : zlevel,
                style : {
                    brushType : 'stroke',
                    iconType : shape.style.iconType != 'droplet'
                               ? shape.style.iconType
                               : 'circle',
                    x : shadowBlur + 1, // 线宽
                    y : shadowBlur + 1,
                    n : shape.style.n,
                    width : shape.style._width * size,
                    height : shape.style._height * size,
                    lineWidth : 1,
                    strokeColor : color,
                    shadowColor : shadowColor,
                    shadowBlur : shadowBlur
                },
                draggable : false,
                hoverable : false
            });
            if (shape.style.iconType == 'pin') {
                effectShape.style.y += effectShape.style.height / 2 * 1.5;
            }

            if (canvasSupported) {  // 提高性能，换成image
                effectShape.style.image = zr.shapeToImage(
                    effectShape, 
                    effectShape.style.width + shadowBlur * 2 + 2, 
                    effectShape.style.height + shadowBlur * 2 + 2
                ).style.image;
                
                effectShape = new ImageShape({
                    zlevel : effectShape.zlevel,
                    style : effectShape.style,
                    draggable : false,
                    hoverable : false
                });
            }
        }
        else {
            effectShape = new ImageShape({
                zlevel : zlevel,
                style : shape.style,
                draggable : false,
                hoverable : false
            });
        }
        
        ecData.clone(shape, effectShape);
        
        // 改变坐标，不能移到前面
        effectShape.position = shape.position;
        effectList.push(effectShape);
        zr.addShape(effectShape);
        
        var devicePixelRatio = shape.type !== 'image' ? (window.devicePixelRatio || 1) : 1;
        var offset = (effectShape.style.width / devicePixelRatio - shape.style._width) / 2;
        effectShape.style.x = shape.style._x - offset;
        effectShape.style.y = shape.style._y - offset;

        if (shape.style.iconType == 'pin') {
            effectShape.style.y -= shape.style.height / 2 * 1.5;
        }

        var duration = (effect.period + Math.random() * 10) * 100;
        
        zr.modShape(
            shape.id, 
            { invisible : true}
        );
        
        var centerX = effectShape.style.x + (effectShape.style.width) / 2 / devicePixelRatio;
        var centerY = effectShape.style.y + (effectShape.style.height) / 2 / devicePixelRatio;

        if (effect.type === 'scale') {
            // 放大效果
            zr.modShape(
                effectShape.id, 
                {
                    scale : [0.1, 0.1, centerX, centerY]
                }
            );
            
            zr.animate(effectShape.id, '', effect.loop)
                .when(
                    duration,
                    {
                        scale : [1, 1, centerX, centerY]
                    }
                )
                .done(function() {
                    shape.effect.show = false;
                    zr.delShape(effectShape.id);
                })
                .start();
        }
        else {
            zr.animate(effectShape.id, 'style', effect.loop)
                .when(
                    duration,
                    {
                        y : effectShape.style.y - distance
                    }
                )
                .when(
                    duration * 2,
                    {
                        y : effectShape.style.y
                    }
                )
                .done(function() {
                    shape.effect.show = false;
                    zr.delShape(effectShape.id);
                })
                .start();
        }
        
    }
    
    function largePoint(zr, effectList, shape, zlevel) {
        var effect = shape.effect;
        var color = effect.color || shape.style.strokeColor || shape.style.color;
        var size = effect.scaleSize;
        var shadowColor = effect.shadowColor || color;
        var shadowBlur = typeof effect.shadowBlur != 'undefined'
                         ? effect.shadowBlur : (size * 2);
        var devicePixelRatio = window.devicePixelRatio || 1;
        var effectShape = new SymbolShape({
            zlevel : zlevel,
            position : shape.position,
            scale : shape.scale,
            style : {
                pointList : shape.style.pointList,
                iconType : shape.style.iconType,
                color : color,
                strokeColor : color,
                shadowColor : shadowColor,
                shadowBlur : shadowBlur * devicePixelRatio,
                random : true,
                brushType: 'fill',
                lineWidth:1,
                size : shape.style.size
            },
            draggable : false,
            hoverable : false
        });
        
        effectList.push(effectShape);
        zr.addShape(effectShape);
        zr.modShape(
            shape.id, 
            { invisible : true}
        );
        
        var duration = Math.round(effect.period * 100);
        var clip1 = {};
        var clip2 = {};
        for (var i = 0; i < 20; i++) {
            effectShape.style['randomMap' + i] = 0;
            clip1 = {};
            clip1['randomMap' + i] = 100;
            clip2 = {};
            clip2['randomMap' + i] = 0;
            effectShape.style['randomMap' + i] = Math.random() * 100;
            zr.animate(effectShape.id, 'style', true)
                .when(duration, clip1)
                .when(duration * 2, clip2)
                .when(duration * 3, clip1)
                .when(duration * 4, clip1)
                .delay(Math.random() * duration * i)
                //.delay(duration / 15 * (15 - i + 1))
                .start();
            
        }
    }
    
    function line(zr, effectList, shape, zlevel, isLarge) {
        var effect = shape.effect;
        var shapeStyle = shape.style;
        var color = effect.color || shapeStyle.strokeColor || shapeStyle.color;
        var shadowColor = effect.shadowColor || shapeStyle.strokeColor || color;
        var size = shapeStyle.lineWidth * effect.scaleSize;
        var shadowBlur = typeof effect.shadowBlur != 'undefined'
                         ? effect.shadowBlur : size;

        var effectShape = new CircleShape({
            zlevel : zlevel,
            style : {
                x : shadowBlur,
                y : shadowBlur,
                r : size,
                color : color,
                shadowColor : shadowColor,
                shadowBlur : shadowBlur
            },
            hoverable : false
        });

        var offset = 0;
        if (canvasSupported && ! isLarge) {  // 提高性能，换成image
            var zlevel = effectShape.zlevel;
            effectShape = zr.shapeToImage(
                effectShape,
                (size + shadowBlur) * 2,
                (size + shadowBlur) * 2
            );
            effectShape.zlevel = zlevel;
            effectShape.hoverable = false;

            offset = shadowBlur;
        }

        if (! isLarge) {
            ecData.clone(shape, effectShape);
            // 改变坐标， 不能移到前面
            effectShape.position = shape.position;
            effectList.push(effectShape);
            zr.addShape(effectShape);
        }

        var effectDone = function () {
            if (! isLarge) {
                shape.effect.show = false;
                zr.delShape(effectShape.id);   
            }
            effectShape.effectAnimator = null;
        };

        if (shape instanceof Polyline) {
            var distanceList = [0];
            var totalDist = 0;
            var pointList = shapeStyle.pointList;
            var controlPointList = shapeStyle.controlPointList;
            for (var i = 1; i < pointList.length; i++) {
                if (controlPointList) {
                    var cp1 = controlPointList[(i - 1) * 2];
                    var cp2 = controlPointList[(i - 1) * 2 + 1];
                    totalDist += vec2.dist(pointList[i - 1], cp1)
                         + vec2.dist(cp1, cp2)
                         + vec2.dist(cp2, pointList[i]);
                }
                else {
                    totalDist += vec2.dist(pointList[i - 1], pointList[i]);
                }
                distanceList.push(totalDist);
            }
            var obj = { p: 0 };
            var animator = zr.animation.animate(obj, { loop: effect.loop });

            for (var i = 0; i < distanceList.length; i++) {
                animator.when(distanceList[i] * effect.period, { p: i });
            }
            animator.during(function () {
                var i = Math.floor(obj.p);
                var x, y;
                if (i == pointList.length - 1) {
                    x = pointList[i][0];
                    y = pointList[i][1];
                }
                else {
                    var t = obj.p - i;
                    var p0 = pointList[i];
                    var p1 = pointList[i + 1];
                    if (controlPointList) {
                        var cp1 = controlPointList[i * 2];
                        var cp2 = controlPointList[i * 2 + 1];
                        x = curveTool.cubicAt(
                            p0[0], cp1[0], cp2[0], p1[0], t
                        );
                        y = curveTool.cubicAt(
                            p0[1], cp1[1], cp2[1], p1[1], t
                        );
                    }
                    else {
                        x = (p1[0] - p0[0]) * t + p0[0];
                        y = (p1[1] - p0[1]) * t + p0[1];   
                    }
                }
                effectShape.style.x = x;
                effectShape.style.y = y;
                if (! isLarge) {
                    zr.modShape(effectShape);
                }
            })
            .done(effectDone)
            .start();

            animator.duration = totalDist * effect.period;

            effectShape.effectAnimator = animator;
        }
        else {
            var x0 = shapeStyle.xStart - offset;
            var y0 = shapeStyle.yStart - offset;
            var x2 = shapeStyle.xEnd - offset;
            var y2 = shapeStyle.yEnd - offset;
            effectShape.style.x = x0;
            effectShape.style.y = y0;

            var distance = (x2 - x0) * (x2 - x0) + (y2 - y0) * (y2 - y0);
            var duration = Math.round(Math.sqrt(Math.round(
                distance * effect.period * effect.period
            )));

            if (shape.style.curveness > 0) {
                var x1 = shapeStyle.cpX1 - offset;
                var y1 = shapeStyle.cpY1 - offset;
                effectShape.effectAnimator = zr.animation.animate(effectShape, { loop: effect.loop })
                    .when(duration, { p: 1 })
                    .during(function (target, t) {
                        effectShape.style.x = curveTool.quadraticAt(
                            x0, x1, x2, t
                        );
                        effectShape.style.y = curveTool.quadraticAt(
                            y0, y1, y2, t
                        );
                        if (! isLarge) {
                            zr.modShape(effectShape);
                        }
                    })
                    .done(effectDone)
                    .start();
            }
            else {
                // 不用 zr.animate，因为在用 ShapeBundle 的时候单个 effectShape 不会
                // 被加到 zrender 中
                effectShape.effectAnimator = zr.animation.animate(effectShape.style, { loop: effect.loop })
                    .when(duration, {
                        x: x2,
                        y: y2
                    })
                    .during(function () {
                        if (! isLarge) {
                            zr.modShape(effectShape);
                        }
                    })
                    .done(effectDone)
                    .start();
            }
            effectShape.effectAnimator.duration = duration;
        }
        return effectShape;
    }

    function largeLine(zr, effectList, shape, zlevel) {
        var effectShape = new ShapeBundle({
            style: {
                shapeList: []
            },
            zlevel: zlevel,
            hoverable: false
        });
        var shapeList = shape.style.shapeList;
        var effect = shape.effect;
        effectShape.position = shape.position;

        var maxDuration = 0;
        var subEffectAnimators = [];
        for (var i = 0; i < shapeList.length; i++) {
            shapeList[i].effect = effect;
            var subEffectShape = line(zr, null, shapeList[i], zlevel, true);
            var subEffectAnimator = subEffectShape.effectAnimator;
            effectShape.style.shapeList.push(subEffectShape);
            if (subEffectAnimator.duration > maxDuration) {
                maxDuration = subEffectAnimator.duration;
            }
            if (i === 0) {
                effectShape.style.color = subEffectShape.style.color;
                effectShape.style.shadowBlur = subEffectShape.style.shadowBlur;
                effectShape.style.shadowColor = subEffectShape.style.shadowColor;
            }
            subEffectAnimators.push(subEffectAnimator);
        }
        effectList.push(effectShape);
        zr.addShape(effectShape);

        var clearAllAnimators = function () {
            for (var i = 0; i < subEffectAnimators.length; i++) {
                subEffectAnimators[i].stop();
            }
        };
        if (maxDuration) {
            effectShape.__dummy = 0;
            // Proxy animator
            var animator = zr.animate(effectShape.id, '', effect.loop)
                .when(maxDuration, {
                    __dummy: 1
                })
                .during(function () {
                    zr.modShape(effectShape);
                })
                .done(function () {
                    shape.effect.show = false;
                    zr.delShape(effectShape.id);
                })
                .start();
            var oldStop = animator.stop;

            animator.stop = function () {
                clearAllAnimators();
                oldStop.call(this);
            };
        }
    }

    return {
        point : point,
        largePoint : largePoint,
        line : line,
        largeLine: largeLine
    };
});
define('echarts/util/ecAnimation', ['require', 'zrender/tool/util', 'zrender/tool/curve', 'zrender/shape/Polygon'], function (require) {
    var zrUtil = require('zrender/tool/util');
    var curveTool = require('zrender/tool/curve');
    
    /**
     * 折线型动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function pointList(zr, oldShape, newShape, duration, easing) {
        var newPointList = newShape.style.pointList;
        var newPointListLen = newPointList.length;
        var oldPointList;

        if (!oldShape) {        // add
            oldPointList = [];
            if (newShape._orient != 'vertical') {
                var y = newPointList[0][1];
                for (var i = 0; i < newPointListLen; i++) {
                    oldPointList[i] = [newPointList[i][0], y];
                }
            }
            else {
                var x = newPointList[0][0];
                for (var i = 0; i < newPointListLen; i++) {
                    oldPointList[i] = [x, newPointList[i][1]];
                }
            }

            if (newShape.type == 'half-smooth-polygon') {
                oldPointList[newPointListLen - 1] = zrUtil.clone(newPointList[newPointListLen - 1]);
                oldPointList[newPointListLen - 2] = zrUtil.clone(newPointList[newPointListLen - 2]);
            }
            oldShape = {style : {pointList : oldPointList}};
        }
        
        oldPointList = oldShape.style.pointList;
        var oldPointListLen = oldPointList.length;
        if (oldPointListLen == newPointListLen) {
            newShape.style.pointList = oldPointList;
        }
        else if (oldPointListLen < newPointListLen) {
            // 原来短，新的长，补全
            newShape.style.pointList = oldPointList.concat(newPointList.slice(oldPointListLen));
        }
        else {
            // 原来长，新的短，截断
            newShape.style.pointList = oldPointList.slice(0, newPointListLen);
        }

        zr.addShape(newShape);
        newShape.__animating = true;
        zr.animate(newShape.id, 'style')
            .when(
                duration,
                { pointList: newPointList }
            )
            .during(function () {
                // Updating bezier points
                if (newShape.updateControlPoints) {
                    newShape.updateControlPoints(newShape.style);
                }
            })
            .done(function() {
                newShape.__animating = false;
            })
            .start(easing);
    }
    
    /**
     * 复制样式
     * 
     * @inner
     * @param {Object} target 目标对象
     * @param {Object} source 源对象
     * @param {...string} props 复制的属性列表
     */
    function cloneStyle(target, source) {
        var len = arguments.length;
        for (var i = 2; i < len; i++) {
            var prop = arguments[i];
            target.style[prop] = source.style[prop];
        }
    }

    /**
     * 方型动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function rectangle(zr, oldShape, newShape, duration, easing) {
        var newShapeStyle = newShape.style;
        if (!oldShape) {        // add
            oldShape = {
                position : newShape.position,
                style : {
                    x : newShapeStyle.x,
                    y : newShape._orient == 'vertical'
                        ? newShapeStyle.y + newShapeStyle.height
                        : newShapeStyle.y,
                    width: newShape._orient == 'vertical' 
                           ? newShapeStyle.width : 0,
                    height: newShape._orient != 'vertical' 
                           ? newShapeStyle.height : 0
                }
            };
        }
        
        var newX = newShapeStyle.x;
        var newY = newShapeStyle.y;
        var newWidth = newShapeStyle.width;
        var newHeight = newShapeStyle.height;
        var newPosition = [newShape.position[0], newShape.position[1]];
        cloneStyle(
            newShape, oldShape,
            'x', 'y', 'width', 'height'
        );
        newShape.position = oldShape.position;

        zr.addShape(newShape);
        if (newPosition[0] != oldShape.position[0] || newPosition[1] != oldShape.position[1]) {
            zr.animate(newShape.id, '')
                .when(
                    duration,
                    {
                        position: newPosition
                    }
                )
                .start(easing);
        }
        
        newShape.__animating = true;
        zr.animate(newShape.id, 'style')
            .when(
                duration,
                {
                    x: newX,
                    y: newY,
                    width: newWidth,
                    height: newHeight
                }
            )
            .done(function() {
                newShape.__animating = false;
            })
            .start(easing);
    }
    
    /**
     * 蜡烛动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function candle(zr, oldShape, newShape, duration, easing) {
        if (!oldShape) {        // add
            var y = newShape.style.y;
            oldShape = {style : {y : [y[0], y[0], y[0], y[0]]}};
        }
        
        var newY = newShape.style.y;
        newShape.style.y = oldShape.style.y;
        zr.addShape(newShape);
        newShape.__animating = true;
        zr.animate(newShape.id, 'style')
            .when(
                duration,
                { y: newY }
            )
            .done(function() {
                newShape.__animating = false;
            })
            .start(easing);
    }

    /**
     * 环型动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function ring(zr, oldShape, newShape, duration, easing) {
        var x = newShape.style.x;
        var y = newShape.style.y;
        var r0 = newShape.style.r0;
        var r = newShape.style.r;
        
        newShape.__animating = true;

        if (newShape._animationAdd != 'r') {
            newShape.style.r0 = 0;
            newShape.style.r = 0;
            newShape.rotation = [Math.PI*2, x, y];
            
            zr.addShape(newShape);
            zr.animate(newShape.id, 'style')
                .when(
                    duration,
                    {
                        r0 : r0,
                        r : r
                    }
                )
                .done(function() {
                    newShape.__animating = false;
                })
                .start(easing);
            zr.animate(newShape.id, '')
                .when(
                    duration,
                    { rotation : [0, x, y] }
                )
                .start(easing);
        }
        else {
            newShape.style.r0 = newShape.style.r;
            
            zr.addShape(newShape);
            zr.animate(newShape.id, 'style')
                .when(
                    duration,
                    {
                        r0 : r0
                    }
                )
                .done(function() {
                    newShape.__animating = false;
                })
                .start(easing);
        }
    }
    
    /**
     * 扇形动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function sector(zr, oldShape, newShape, duration, easing) {
        if (!oldShape) {        // add
            if (newShape._animationAdd != 'r') {
                oldShape = {
                    style : {
                        startAngle : newShape.style.startAngle,
                        endAngle : newShape.style.startAngle
                    }
                };
            }
            else {
                oldShape = {style : {r0 : newShape.style.r}};
            }
        }
        
        var startAngle = newShape.style.startAngle;
        var endAngle = newShape.style.endAngle;
        
        cloneStyle(
            newShape, oldShape,
            'startAngle', 'endAngle'
        );
        
        zr.addShape(newShape);
        newShape.__animating = true;
        zr.animate(newShape.id, 'style')
            .when(
                duration,
                {
                    startAngle : startAngle,
                    endAngle : endAngle
                }
            )
            .done(function() {
                newShape.__animating = false;
            })
            .start(easing);
    }
    
    /**
     * 文本动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function text(zr, oldShape, newShape, duration, easing) {
        if (!oldShape) {        // add
            oldShape = {
                style : {
                    x : newShape.style.textAlign == 'left' 
                        ? newShape.style.x + 100
                        : newShape.style.x - 100,
                    y : newShape.style.y
                }
            };
        }
        
        var x = newShape.style.x;
        var y = newShape.style.y;
        
        cloneStyle(
            newShape, oldShape,
            'x', 'y'
        );
        
        zr.addShape(newShape);
        newShape.__animating = true;
        zr.animate(newShape.id, 'style')
            .when(
                duration,
                {
                    x : x,
                    y : y
                }
            )
            .done(function() {
                newShape.__animating = false;
            })
            .start(easing);
    }
    
    /**
     * 多边形动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function polygon(zr, oldShape, newShape, duration, easing) {
        var rect = require('zrender/shape/Polygon').prototype.getRect(newShape.style);
        var x = rect.x + rect.width / 2;
        var y = rect.y + rect.height / 2;
        
        newShape.scale = [0.1, 0.1, x, y];
        zr.addShape(newShape);
        newShape.__animating = true;
        zr.animate(newShape.id, '')
            .when(
                duration,
                {
                    scale : [1, 1, x, y]
                }
            )
            .done(function() {
                newShape.__animating = false;
            })
            .start(easing);
    }
    
    /**
     * 和弦动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function ribbon(zr, oldShape, newShape, duration, easing) {
        if (!oldShape) {        // add
            oldShape = {
                style : {
                    source0 : 0,
                    source1 : newShape.style.source1 > 0 ? 360 : -360,
                    target0 : 0,
                    target1 : newShape.style.target1 > 0 ? 360 : -360
                }
            };
        }
        
        var source0 = newShape.style.source0;
        var source1 = newShape.style.source1;
        var target0 = newShape.style.target0;
        var target1 = newShape.style.target1;
        
        if (oldShape.style) {
            cloneStyle(
                newShape, oldShape,
                'source0', 'source1', 'target0', 'target1'
            );
        }
        
        zr.addShape(newShape);
        newShape.__animating = true;
        zr.animate(newShape.id, 'style')
            .when(
                duration,
                {
                    source0 : source0,
                    source1 : source1,
                    target0 : target0,
                    target1 : target1
                }
            )
            .done(function() {
                newShape.__animating = false;
            })
            .start(easing);
    }
    
    /**
     * gaugePointer动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function gaugePointer(zr, oldShape, newShape, duration, easing) {
        if (!oldShape) {        // add
            oldShape = {
                style : {
                    angle : newShape.style.startAngle
                }
            };
        }
        
        var angle = newShape.style.angle;
        newShape.style.angle = oldShape.style.angle;
        zr.addShape(newShape);
        newShape.__animating = true;
        zr.animate(newShape.id, 'style')
            .when(
                duration,
                {
                    angle : angle
                }
            )
            .done(function() {
                newShape.__animating = false;
            })
            .start(easing);
    }
    
    /**
     * icon动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function icon(zr, oldShape, newShape, duration, easing, delay) {
        // 避免markPoint特效取值在动画帧上
        newShape.style._x = newShape.style.x;
        newShape.style._y = newShape.style.y;
        newShape.style._width = newShape.style.width;
        newShape.style._height = newShape.style.height;

        if (!oldShape) {    // add
            var x = newShape._x || 0;
            var y = newShape._y || 0;
            newShape.scale = [0.01, 0.01, x, y];
            zr.addShape(newShape);
            newShape.__animating = true;
            zr.animate(newShape.id, '')
                .delay(delay)
                .when(
                    duration,
                    {scale : [1, 1, x, y]}
                )
                .done(function() {
                    newShape.__animating = false;
                })
                .start(easing || 'QuinticOut');
        }
        else {              // mod
            rectangle(zr, oldShape, newShape, duration, easing);
        }
    }
    
    /**
     * line动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function line(zr, oldShape, newShape, duration, easing) {
        if (!oldShape) {
            oldShape = {
                style : {
                    xStart : newShape.style.xStart,
                    yStart : newShape.style.yStart,
                    xEnd : newShape.style.xStart,
                    yEnd : newShape.style.yStart
                }
            };
        }
        
        var xStart = newShape.style.xStart;
        var xEnd = newShape.style.xEnd;
        var yStart = newShape.style.yStart;
        var yEnd = newShape.style.yEnd;

        cloneStyle(
            newShape, oldShape,
            'xStart', 'xEnd', 'yStart', 'yEnd'
        );

        zr.addShape(newShape);
        newShape.__animating = true;
        zr.animate(newShape.id, 'style')
            .when(
                duration,
                {
                    xStart: xStart,
                    xEnd: xEnd,
                    yStart: yStart,
                    yEnd: yEnd
                }
            )
            .done(function() {
                newShape.__animating = false;
            })
            .start(easing);
    }
    
    /**
     * markline动画
     * 
     * @param {ZRender} zr
     * @param {shape} oldShape
     * @param {shape} newShape
     * @param {number} duration
     * @param {tring} easing
     */
    function markline(zr, oldShape, newShape, duration, easing) {
        easing = easing || 'QuinticOut';
        newShape.__animating = true;
        zr.addShape(newShape);
        var newShapeStyle = newShape.style;

        var animationDone = function () {
            newShape.__animating = false;
        };
        var x0 = newShapeStyle.xStart;
        var y0 = newShapeStyle.yStart;
        var x2 = newShapeStyle.xEnd;
        var y2 = newShapeStyle.yEnd;
        if (newShapeStyle.curveness > 0) {
            newShape.updatePoints(newShapeStyle);
            var obj = { p: 0 };
            var x1 = newShapeStyle.cpX1;
            var y1 = newShapeStyle.cpY1;
            var newXArr = [];
            var newYArr = [];
            var subdivide = curveTool.quadraticSubdivide;
            zr.animation.animate(obj)
                .when(duration, { p: 1 })
                .during(function () {
                    // Calculate subdivided curve
                    subdivide(x0, x1, x2, obj.p, newXArr);
                    subdivide(y0, y1, y2, obj.p, newYArr);
                    newShapeStyle.cpX1 = newXArr[1];
                    newShapeStyle.cpY1 = newYArr[1];
                    newShapeStyle.xEnd = newXArr[2];
                    newShapeStyle.yEnd = newYArr[2];
                    zr.modShape(newShape);
                })
                .done(animationDone)
                .start(easing);
        }
        else {
            zr.animate(newShape.id, 'style')
                .when(0, {
                    xEnd: x0,
                    yEnd: y0
                })
                .when(duration, {
                    xEnd: x2,
                    yEnd: y2
                })
                .done(animationDone)
                .start(easing);
        }
    }

    return {
        pointList : pointList,
        rectangle : rectangle,
        candle : candle,
        ring : ring,
        sector : sector,
        text : text,
        polygon : polygon,
        ribbon : ribbon,
        gaugePointer : gaugePointer,
        icon : icon,
        line : line,
        markline : markline
    };
});
define('echarts/util/accMath', [], function () {
    // 除法函数，用来得到精确的除法结果 
    // 说明：javascript的除法结果会有误差，在两个浮点数相除的时候会比较明显。这个函数返回较为精确的除法结果。 
    // 调用：accDiv(arg1,arg2) 
    // 返回值：arg1除以arg2的精确结果
    function accDiv(arg1,arg2){
        var s1 = arg1.toString();
        var s2 = arg2.toString(); 
        var m = 0;
        try {
            m = s2.split('.')[1].length;
        }
        catch(e) {}
        try {
            m -= s1.split('.')[1].length;
        }
        catch(e) {}
        
        return (s1.replace('.', '') - 0) / (s2.replace('.', '') - 0) * Math.pow(10, m);
    }

    // 乘法函数，用来得到精确的乘法结果
    // 说明：javascript的乘法结果会有误差，在两个浮点数相乘的时候会比较明显。这个函数返回较为精确的乘法结果。 
    // 调用：accMul(arg1,arg2) 
    // 返回值：arg1乘以arg2的精确结果
    function accMul(arg1, arg2) {
        var s1 = arg1.toString();
        var s2 = arg2.toString();
        var m = 0;
        try {
            m += s1.split('.')[1].length;
        }
        catch(e) {}
        try {
            m += s2.split('.')[1].length;
        }
        catch(e) {}
        
        return (s1.replace('.', '') - 0) * (s2.replace('.', '') - 0) / Math.pow(10, m);
    }

    // 加法函数，用来得到精确的加法结果 
    // 说明：javascript的加法结果会有误差，在两个浮点数相加的时候会比较明显。这个函数返回较为精确的加法结果。 
    // 调用：accAdd(arg1,arg2) 
    // 返回值：arg1加上arg2的精确结果 
    function accAdd(arg1, arg2) {
        var r1 = 0;
        var r2 = 0;
        try {
            r1 = arg1.toString().split('.')[1].length;
        }
        catch(e) {}
        try {
            r2 = arg2.toString().split('.')[1].length;
        }
        catch(e) {}
        
        var m = Math.pow(10, Math.max(r1, r2));
        return (Math.round(arg1 * m) + Math.round(arg2 * m)) / m; 
    }

    //减法函数，用来得到精确的减法结果 
    //说明：javascript的减法结果会有误差，在两个浮点数减法的时候会比较明显。这个函数返回较为精确的减法结果。 
    //调用：accSub(arg1,arg2) 
    //返回值：arg1减法arg2的精确结果 
    function accSub(arg1,arg2) {
        return accAdd(arg1, -arg2);
    }

    return {
        accDiv : accDiv,
        accMul : accMul,
        accAdd : accAdd,
        accSub : accSub
    };
});
define('echarts/component/base', ['require', '../config', '../util/ecData', '../util/ecQuery', '../util/number', 'zrender/tool/util', 'zrender/tool/env'], function (require) {
    var ecConfig = require('../config');
    var ecData = require('../util/ecData');
    var ecQuery = require('../util/ecQuery');
    var number = require('../util/number');
    var zrUtil = require('zrender/tool/util');
    
    function Base(ecTheme, messageCenter, zr, option, myChart){
        this.ecTheme = ecTheme;
        this.messageCenter = messageCenter;
        this.zr =zr;
        this.option = option;
        this.series = option.series;
        this.myChart = myChart;
        this.component = myChart.component;

        this.shapeList = [];
        this.effectList = [];
        
        var self = this;
        
        self._onlegendhoverlink = function(param) {
            if (self.legendHoverLink) {
                var targetName = param.target;
                var name;
                for (var i = self.shapeList.length - 1; i >= 0; i--) {
                    name = self.type == ecConfig.CHART_TYPE_PIE
                           || self.type == ecConfig.CHART_TYPE_FUNNEL
                           ? ecData.get(self.shapeList[i], 'name')
                           : (ecData.get(self.shapeList[i], 'series') || {}).name;
                    if (name == targetName 
                        && !self.shapeList[i].invisible 
                        && !self.shapeList[i].__animating
                    ) {
                        self.zr.addHoverShape(self.shapeList[i]);
                    }
                }
            }
        };
        messageCenter && messageCenter.bind(
            ecConfig.EVENT.LEGEND_HOVERLINK, this._onlegendhoverlink
        );
    }

    /**
     * 基类方法
     */
    Base.prototype = {
        canvasSupported: require('zrender/tool/env').canvasSupported,
        _getZ : function(zWhat) {
            if (this[zWhat] != null) {
                return this[zWhat];
            }
            var opt = this.ecTheme[this.type];
            if (opt && opt[zWhat] != null) {
                return opt[zWhat];
            }
            opt = ecConfig[this.type];
            if (opt && opt[zWhat] != null) {
                return opt[zWhat];
            }
            return 0;
        },

        /**
         * 获取zlevel基数配置
         */
        getZlevelBase: function () {
            return this._getZ('zlevel');
        },
        
        /**
         * 获取z基数配置
         */
        getZBase: function() {
            return this._getZ('z');
        },

        /**
         * 参数修正&默认值赋值
         * @param {Object} opt 参数
         *
         * @return {Object} 修正后的参数
         */
        reformOption: function (opt) {
            // 默认配置项动态多级合并，依赖加载的组件选项未被merge到ecTheme里，需要从config里取
            opt = zrUtil.merge(
                       zrUtil.merge(
                           opt || {},
                           zrUtil.clone(this.ecTheme[this.type] || {})
                       ),
                       zrUtil.clone(ecConfig[this.type] || {})
                   );
            this.z = opt.z;
            this.zlevel = opt.zlevel;
            return opt;
        },
        
        /**
         * css类属性数组补全，如padding，margin等~
         */
        reformCssArray: function (p) {
            if (p instanceof Array) {
                switch (p.length + '') {
                    case '4':
                        return p;
                    case '3':
                        return [p[0], p[1], p[2], p[1]];
                    case '2':
                        return [p[0], p[1], p[0], p[1]];
                    case '1':
                        return [p[0], p[0], p[0], p[0]];
                    case '0':
                        return [0, 0, 0, 0];
                }
            }
            else {
                return [p, p, p, p];
            }
        },
        
        getShapeById: function(id) {
            for (var i = 0, l = this.shapeList.length; i < l; i++) {
                if (this.shapeList[i].id === id) {
                    return this.shapeList[i];
                }
            }
            return null;
        },
        
        /**
         * 获取自定义和默认配置合并后的字体设置
         */
        getFont: function (textStyle) {
            var finalTextStyle = this.getTextStyle(
                zrUtil.clone(textStyle)
            );
            return finalTextStyle.fontStyle + ' '
                   + finalTextStyle.fontWeight + ' '
                   + finalTextStyle.fontSize + 'px '
                   + finalTextStyle.fontFamily;
        },

        /**
         * 获取统一主题字体样式
         */
        getTextStyle: function(targetStyle) {
            return zrUtil.merge(
                       zrUtil.merge(
                           targetStyle || {},
                           this.ecTheme.textStyle
                       ),
                       ecConfig.textStyle
                   );
        },
        
        getItemStyleColor: function (itemColor, seriesIndex, dataIndex, data) {
            return typeof itemColor === 'function'
                   ? itemColor.call(
                        this.myChart,
                        {
                            seriesIndex: seriesIndex,
                            series: this.series[seriesIndex],
                            dataIndex: dataIndex,
                            data: data
                        }
                   )
                   : itemColor;
            
        }, 

        /**
         * @parmas {object | number} data 目标data
         * @params {string= | number=} defaultData 无数据时默认返回
         */
        getDataFromOption: function (data, defaultData) {
            return data != null ? (data.value != null ? data.value : data) : defaultData;
        },
        
        // 亚像素优化
        subPixelOptimize: function (position, lineWidth) {
            if (lineWidth % 2 === 1) {
                //position += position === Math.ceil(position) ? 0.5 : 0;
                position = Math.floor(position) + 0.5;
            }
            else {
                position = Math.round(position);
            }
            return position;
        },
        
        // 默认resize
        resize: function () {
            this.refresh && this.refresh();
            this.clearEffectShape && this.clearEffectShape(true);
            var self = this;
            setTimeout(function(){
                self.animationEffect && self.animationEffect();
            },200);
        },

        /**
         * 清除图形数据，实例仍可用
         */
        clear :function () {
            this.clearEffectShape && this.clearEffectShape();
            this.zr && this.zr.delShape(this.shapeList);
            this.shapeList = [];
        },

        /**
         * 释放后实例不可用
         */
        dispose: function () {
            this.onbeforDispose && this.onbeforDispose();
            this.clear();
            this.shapeList = null;
            this.effectList = null;
            this.messageCenter && this.messageCenter.unbind(
                ecConfig.EVENT.LEGEND_HOVERLINK, this._onlegendhoverlink
            );
            this.onafterDispose && this.onafterDispose();
        },
        
        query: ecQuery.query,
        deepQuery: ecQuery.deepQuery,
        deepMerge: ecQuery.deepMerge,
        
        parsePercent: number.parsePercent,
        parseCenter: number.parseCenter,
        parseRadius: number.parseRadius,
        numAddCommas: number.addCommas,

        getPrecision: number.getPrecision
    };
    
    return Base;
});
define('echarts/layout/EdgeBundling', ['require', '../data/KDTree', 'zrender/tool/vector'], function (require) {

    var KDTree = require('../data/KDTree');
    var vec2 = require('zrender/tool/vector');
    var v2Create = vec2.create;
    var v2DistSquare = vec2.distSquare;
    var v2Dist = vec2.dist;
    var v2Copy = vec2.copy;
    var v2Clone = vec2.clone;

    function squaredDistance(a, b) {
        a = a.array;
        b = b.array;

        var x = b[0] - a[0];
        var y = b[1] - a[1];
        var z = b[2] - a[2];
        var w = b[3] - a[3];

        return x * x + y * y + z * z + w * w;
    }

    function CoarsenedEdge(group) {
        this.points = [
            group.mp0, group.mp1
        ];

        this.group = group;
    }

    function Edge(edge) {
        var points = edge.points;
        // Sort on y
        if (
            points[0][1] < points[1][1]
            // If coarsened edge is flipped, the final composition of meet point
            // will be unordered
            || edge instanceof CoarsenedEdge
        ) {
            this.array = [points[0][0], points[0][1], points[1][0], points[1][1]];
            this._startPoint = points[0];
            this._endPoint = points[1];
        }
        else {
            this.array = [points[1][0], points[1][1], points[0][0], points[0][1]];
            this._startPoint = points[1];
            this._endPoint = points[0];
        }

        this.ink = v2Dist(points[0], points[1]);

        this.edge = edge;

        this.group = null;
    }

    Edge.prototype.getStartPoint = function () {
        return this._startPoint;
    };

    Edge.prototype.getEndPoint = function () {
        return this._endPoint;
    };

    function BundledEdgeGroup() {

        this.edgeList = [];

        this.mp0 = v2Create();
        this.mp1 = v2Create();

        this.ink = 0;
    }

    BundledEdgeGroup.prototype.addEdge = function (edge) {
        edge.group = this;
        this.edgeList.push(edge);
    };

    BundledEdgeGroup.prototype.removeEdge = function (edge) {
        edge.group = null;
        this.edgeList.splice(this.edgeList.indexOf(edge), 1);
    };

    /**
     * @constructor
     * @alias module:echarts/layout/EdgeBundling
     */
    function EdgeBundling() {
        this.maxNearestEdge = 6;
        this.maxTurningAngle = Math.PI / 4;
        this.maxIteration = 20;
    }

    EdgeBundling.prototype = {
        
        constructor: EdgeBundling,

        run: function (rawEdges) {
            var res = this._iterate(rawEdges);
            var nIterate = 0;
            while (nIterate++ < this.maxIteration) {
                var coarsenedEdges = [];
                for (var i = 0; i < res.groups.length; i++) {
                    coarsenedEdges.push(new CoarsenedEdge(res.groups[i]));
                }
                var newRes = this._iterate(coarsenedEdges);
                if (newRes.savedInk <= 0) {
                    break;
                } else {
                    res = newRes;
                }
            }

            // Get new edges
            var newEdges = [];

            function pointApproxEqual(p0, p1) {
                // Use Float32Array may affect the precision
                return v2DistSquare(p0, p1) < 1e-10;
            }
            // Clone all points to make sure all points in edge will not reference to the same array
            // And clean the duplicate points
            function cleanEdgePoints(edgePoints, rawEdgePoints) {
                var res = [];
                var off = 0;
                for (var i = 0; i < edgePoints.length; i++) {
                    if (! (off > 0 && pointApproxEqual(edgePoints[i], res[off - 1]))) {
                        res[off++] = v2Clone(edgePoints[i]);
                    }
                }
                // Edge has been reversed
                if (rawEdgePoints[0] && !pointApproxEqual(res[0], rawEdgePoints[0])) {
                    res = res.reverse();
                }
                return res;
            }

            var buildNewEdges = function (groups, fromEdgePoints) {
                var newEdgePoints;
                for (var i = 0; i < groups.length; i++) {
                    var group = groups[i];
                    if (
                        group.edgeList[0]
                        && (group.edgeList[0].edge instanceof CoarsenedEdge)
                    ) {
                        var newGroups = [];
                        for (var j = 0; j < group.edgeList.length; j++) {
                            newGroups.push(group.edgeList[j].edge.group);
                        }
                        if (! fromEdgePoints) {
                            newEdgePoints = [];
                        } else {
                            newEdgePoints = fromEdgePoints.slice();
                        }
                        newEdgePoints.unshift(group.mp0);
                        newEdgePoints.push(group.mp1);
                        buildNewEdges(newGroups, newEdgePoints);
                    } else {
                        // console.log(group.edgeList.length);
                        for (var j = 0; j < group.edgeList.length; j++) {
                            var edge = group.edgeList[j];
                            if (! fromEdgePoints) {
                                newEdgePoints = [];
                            } else {
                                newEdgePoints = fromEdgePoints.slice();
                            }
                            newEdgePoints.unshift(group.mp0);
                            newEdgePoints.push(group.mp1);
                            newEdgePoints.unshift(edge.getStartPoint());
                            newEdgePoints.push(edge.getEndPoint());
                            newEdges.push({
                                points: cleanEdgePoints(newEdgePoints, edge.edge.points),
                                rawEdge: edge.edge
                            });
                        }
                    }
                }
            };

            buildNewEdges(res.groups);

            return newEdges;
        },

        _iterate: function (rawEdges) {
            var edges = [];
            var groups = [];
            var totalSavedInk = 0;
            for (var i = 0; i < rawEdges.length; i++) {
                var edge = new Edge(rawEdges[i]);
                edges.push(edge);
            }

            var tree = new KDTree(edges, 4);

            var nearests = [];

            var _mp0 = v2Create();
            var _mp1 = v2Create();
            var _newGroupInk = 0;
            var mp0 = v2Create();
            var mp1 = v2Create();
            var newGroupInk = 0;
            for (var i = 0; i < edges.length; i++) {
                var edge = edges[i];
                if (edge.group) {
                    // Edge have been groupped
                    continue;
                }
                tree.nearestN(
                    edge, this.maxNearestEdge,
                    squaredDistance, nearests
                );
                var maxSavedInk = 0;
                var mostSavingInkEdge = null;
                var lastCheckedGroup = null;
                for (var j = 0; j < nearests.length; j++) {
                    var nearest = nearests[j];
                    var savedInk = 0;
                    if (nearest.group) {
                        if (nearest.group !== lastCheckedGroup) {
                            lastCheckedGroup = nearest.group;
                            _newGroupInk = this._calculateGroupEdgeInk(
                                nearest.group, edge, _mp0, _mp1
                            );
                            savedInk = nearest.group.ink + edge.ink - _newGroupInk;
                        }
                    }
                    else {
                        _newGroupInk = this._calculateEdgeEdgeInk(
                            edge, nearest, _mp0, _mp1
                        );
                        savedInk = nearest.ink + edge.ink - _newGroupInk;
                    }
                    if (savedInk > maxSavedInk) {
                        maxSavedInk = savedInk;
                        mostSavingInkEdge = nearest;
                        v2Copy(mp1, _mp1);
                        v2Copy(mp0, _mp0);
                        newGroupInk = _newGroupInk;
                    }
                }
                if (mostSavingInkEdge) {
                    totalSavedInk += maxSavedInk;
                    var group;
                    if (! mostSavingInkEdge.group) {
                        group = new BundledEdgeGroup();
                        groups.push(group);
                        group.addEdge(mostSavingInkEdge);
                    }
                    group = mostSavingInkEdge.group;
                    // Use the meet point and group ink calculated before
                    v2Copy(group.mp0, mp0);
                    v2Copy(group.mp1, mp1);
                    group.ink = newGroupInk;
                    mostSavingInkEdge.group.addEdge(edge);
                }
                else {
                    var group = new BundledEdgeGroup();
                    groups.push(group);
                    v2Copy(group.mp0, edge.getStartPoint());
                    v2Copy(group.mp1, edge.getEndPoint());
                    group.ink = edge.ink;
                    group.addEdge(edge);
                }
            }

            return {
                groups: groups,
                edges: edges,
                savedInk: totalSavedInk
            };
        },

        _calculateEdgeEdgeInk: (function () {
            var startPointSet = [];
            var endPointSet = [];
            return function (e0, e1, mp0, mp1) {
                startPointSet[0] = e0.getStartPoint();
                startPointSet[1] = e1.getStartPoint();
                endPointSet[0] = e0.getEndPoint();
                endPointSet[1] = e1.getEndPoint();

                this._calculateMeetPoints(
                    startPointSet, endPointSet, mp0, mp1
                );
                var ink = v2Dist(startPointSet[0], mp0)
                    + v2Dist(mp0, mp1)
                    + v2Dist(mp1, endPointSet[0])
                    + v2Dist(startPointSet[1], mp0)
                    + v2Dist(mp1, endPointSet[1]);

                return ink;
            };
        })(),

        _calculateGroupEdgeInk: function (group, edgeTryAdd, mp0, mp1) {
            var startPointSet = [];
            var endPointSet = [];
            for (var i = 0; i < group.edgeList.length; i++) {
                var edge = group.edgeList[i];
                startPointSet.push(edge.getStartPoint());
                endPointSet.push(edge.getEndPoint());
            }
            startPointSet.push(edgeTryAdd.getStartPoint());
            endPointSet.push(edgeTryAdd.getEndPoint());

            this._calculateMeetPoints(
                startPointSet, endPointSet, mp0, mp1
            );

            var ink = v2Dist(mp0, mp1);
            for (var i = 0; i < startPointSet.length; i++) {
                ink += v2Dist(startPointSet[i], mp0)
                    + v2Dist(endPointSet[i], mp1);
            }

            return ink;
        },

        /**
         * Calculating the meet points
         * @method
         * @param {Array} startPointSet Start points set of bundled edges
         * @param {Array} endPointSet End points set of bundled edges
         * @param {Array.<number>} mp0 Output meet point 0
         * @param {Array.<number>} mp1 Output meet point 1
         */
        _calculateMeetPoints: (function () {
            var cp0 = v2Create();
            var cp1 = v2Create();
            return function (startPointSet, endPointSet, mp0, mp1) {
                vec2.set(cp0, 0, 0);
                vec2.set(cp1, 0, 0);
                var len = startPointSet.length;
                // Calculate the centroid of start points set
                for (var i = 0; i < len; i++) {
                    vec2.add(cp0, cp0, startPointSet[i]);
                }
                vec2.scale(cp0, cp0, 1 / len);

                // Calculate the centroid of end points set
                len = endPointSet.length;
                for (var i = 0; i < len; i++) {
                    vec2.add(cp1, cp1, endPointSet[i]);
                }
                vec2.scale(cp1, cp1, 1 / len);

                this._limitTurningAngle(
                    startPointSet, cp0, cp1, mp0
                );
                this._limitTurningAngle(
                    endPointSet, cp1, cp0, mp1
                );
            };
        })(),

        _limitTurningAngle: (function () {
            var v10 = v2Create();
            var vTmp = v2Create();
            var project = v2Create();
            var tmpOut = v2Create();
            return function (pointSet, p0, p1, out) {
                // Limit the max turning angle
                var maxTurningAngleCos = Math.cos(this.maxTurningAngle);
                var maxTurningAngleTan = Math.tan(this.maxTurningAngle);

                vec2.sub(v10, p0, p1);
                vec2.normalize(v10, v10);

                // Simply copy the centroid point if no need to turn the angle
                vec2.copy(out, p0);

                var maxMovement = 0;
                for (var i = 0; i < pointSet.length; i++) {
                    var p = pointSet[i];
                    vec2.sub(vTmp, p, p0);
                    var len = vec2.len(vTmp);
                    vec2.scale(vTmp, vTmp, 1 / len);
                    var turningAngleCos = vec2.dot(vTmp, v10);
                    // Turning angle is to large
                    if (turningAngleCos < maxTurningAngleCos) {
                        // Calculat p's project point on vector p1-p0 
                        // and distance to the vector
                        vec2.scaleAndAdd(
                            project, p0, v10, len * turningAngleCos
                        );
                        var distance = v2Dist(project, p);

                        // Use the max turning angle to calculate the new meet point
                        var d = distance / maxTurningAngleTan;
                        vec2.scaleAndAdd(tmpOut, project, v10, -d);

                        var movement = v2DistSquare(tmpOut, p0);
                        if (movement > maxMovement) {
                            maxMovement = movement;
                            vec2.copy(out, tmpOut);
                        }
                    }
                }
            };
        })()
    };

    return EdgeBundling;
});
define('zrender/tool/area', ['require', './util', './curve'], function (require) {

        'use strict';

        var util = require('./util');
        var curve = require('./curve');

        var _ctx;
        
        var _textWidthCache = {};
        var _textHeightCache = {};
        var _textWidthCacheCounter = 0;
        var _textHeightCacheCounter = 0;
        var TEXT_CACHE_MAX = 5000;
            
        var PI2 = Math.PI * 2;

        function normalizeRadian(angle) {
            angle %= PI2;
            if (angle < 0) {
                angle += PI2;
            }
            return angle;
        }
        /**
         * 包含判断
         *
         * @param {Object} shape : 图形
         * @param {Object} area ： 目标区域
         * @param {number} x ： 横坐标
         * @param {number} y ： 纵坐标
         */
        function isInside(shape, area, x, y) {
            if (!area || !shape) {
                // 无参数或不支持类型
                return false;
            }
            var zoneType = shape.type;

            _ctx = _ctx || util.getContext();

            // 未实现或不可用时(excanvas不支持)则数学运算，主要是line，polyline，ring
            var _mathReturn = _mathMethod(shape, area, x, y);
            if (typeof _mathReturn != 'undefined') {
                return _mathReturn;
            }

            if (shape.buildPath && _ctx.isPointInPath) {
                return _buildPathMethod(shape, _ctx, area, x, y);
            }

            // 上面的方法都行不通时
            switch (zoneType) {
                case 'ellipse': // Todo，不精确
                    return true;
                // 旋轮曲线  不准确
                case 'trochoid':
                    var _r = area.location == 'out'
                            ? area.r1 + area.r2 + area.d
                            : area.r1 - area.r2 + area.d;
                    return isInsideCircle(area, x, y, _r);
                // 玫瑰线 不准确
                case 'rose' :
                    return isInsideCircle(area, x, y, area.maxr);
                // 路径，椭圆，曲线等-----------------13
                default:
                    return false;   // Todo，暂不支持
            }
        }

        /**
         * @param {Object} shape : 图形
         * @param {Object} area ：目标区域
         * @param {number} x ： 横坐标
         * @param {number} y ： 纵坐标
         * @return {boolean=} true表示坐标处在图形中
         */
        function _mathMethod(shape, area, x, y) {
            var zoneType = shape.type;
            // 在矩形内则部分图形需要进一步判断
            switch (zoneType) {
                // 贝塞尔曲线
                case 'bezier-curve':
                    if (typeof(area.cpX2) === 'undefined') {
                        return isInsideQuadraticStroke(
                            area.xStart, area.yStart,
                            area.cpX1, area.cpY1, 
                            area.xEnd, area.yEnd,
                            area.lineWidth, x, y
                        );
                    }
                    return isInsideCubicStroke(
                        area.xStart, area.yStart,
                        area.cpX1, area.cpY1, 
                        area.cpX2, area.cpY2, 
                        area.xEnd, area.yEnd,
                        area.lineWidth, x, y
                    );
                // 线
                case 'line':
                    return isInsideLine(
                        area.xStart, area.yStart,
                        area.xEnd, area.yEnd,
                        area.lineWidth, x, y
                    );
                // 折线
                case 'polyline':
                    return isInsidePolyline(
                        area.pointList, area.lineWidth, x, y
                    );
                // 圆环
                case 'ring':
                    return isInsideRing(
                        area.x, area.y, area.r0, area.r, x, y
                    );
                // 圆形
                case 'circle':
                    return isInsideCircle(
                        area.x, area.y, area.r, x, y
                    );
                // 扇形
                case 'sector':
                    var startAngle = area.startAngle * Math.PI / 180;
                    var endAngle = area.endAngle * Math.PI / 180;
                    if (!area.clockWise) {
                        startAngle = -startAngle;
                        endAngle = -endAngle;
                    }
                    return isInsideSector(
                        area.x, area.y, area.r0, area.r,
                        startAngle, endAngle,
                        !area.clockWise,
                        x, y
                    );
                // 多边形
                case 'path':
                    return area.pathArray && isInsidePath(
                        area.pathArray, Math.max(area.lineWidth, 5),
                        area.brushType, x, y
                    );
                case 'polygon':
                case 'star':
                case 'isogon':
                    return isInsidePolygon(area.pointList, x, y);
                // 文本
                case 'text':
                    var rect =  area.__rect || shape.getRect(area);
                    return isInsideRect(
                        rect.x, rect.y, rect.width, rect.height, x, y
                    );
                // 矩形
                case 'rectangle':
                // 图片
                case 'image':
                    return isInsideRect(
                        area.x, area.y, area.width, area.height, x, y
                    );
            }
        }

        /**
         * 通过buildPath方法来判断，三个方法中较快，但是不支持线条类型的shape，
         * 而且excanvas不支持isPointInPath方法
         *
         * @param {Object} shape ： shape
         * @param {Object} context : 上下文
         * @param {Object} area ：目标区域
         * @param {number} x ： 横坐标
         * @param {number} y ： 纵坐标
         * @return {boolean} true表示坐标处在图形中
         */
        function _buildPathMethod(shape, context, area, x, y) {
            // 图形类实现路径创建了则用类的path
            context.beginPath();
            shape.buildPath(context, area);
            context.closePath();
            return context.isPointInPath(x, y);
        }

        /**
         * !isInside
         */
        function isOutside(shape, area, x, y) {
            return !isInside(shape, area, x, y);
        }

        /**
         * 线段包含判断
         * @param  {number}  x0
         * @param  {number}  y0
         * @param  {number}  x1
         * @param  {number}  y1
         * @param  {number}  lineWidth
         * @param  {number}  x
         * @param  {number}  y
         * @return {boolean}
         */
        function isInsideLine(x0, y0, x1, y1, lineWidth, x, y) {
            if (lineWidth === 0) {
                return false;
            }
            var _l = Math.max(lineWidth, 5);
            var _a = 0;
            var _b = x0;
            // Quick reject
            if (
                (y > y0 + _l && y > y1 + _l)
                || (y < y0 - _l && y < y1 - _l)
                || (x > x0 + _l && x > x1 + _l)
                || (x < x0 - _l && x < x1 - _l)
            ) {
                return false;
            }

            if (x0 !== x1) {
                _a = (y0 - y1) / (x0 - x1);
                _b = (x0 * y1 - x1 * y0) / (x0 - x1) ;
            }
            else {
                return Math.abs(x - x0) <= _l / 2;
            }
            var tmp = _a * x - y + _b;
            var _s = tmp * tmp / (_a * _a + 1);
            return _s <= _l / 2 * _l / 2;
        }

        /**
         * 三次贝塞尔曲线描边包含判断
         * @param  {number}  x0
         * @param  {number}  y0
         * @param  {number}  x1
         * @param  {number}  y1
         * @param  {number}  x2
         * @param  {number}  y2
         * @param  {number}  x3
         * @param  {number}  y3
         * @param  {number}  lineWidth
         * @param  {number}  x
         * @param  {number}  y
         * @return {boolean}
         */
        function isInsideCubicStroke(
            x0, y0, x1, y1, x2, y2, x3, y3,
            lineWidth, x, y
        ) {
            if (lineWidth === 0) {
                return false;
            }
            var _l = Math.max(lineWidth, 5);
            // Quick reject
            if (
                (y > y0 + _l && y > y1 + _l && y > y2 + _l && y > y3 + _l)
                || (y < y0 - _l && y < y1 - _l && y < y2 - _l && y < y3 - _l)
                || (x > x0 + _l && x > x1 + _l && x > x2 + _l && x > x3 + _l)
                || (x < x0 - _l && x < x1 - _l && x < x2 - _l && x < x3 - _l)
            ) {
                return false;
            }
            var d =  curve.cubicProjectPoint(
                x0, y0, x1, y1, x2, y2, x3, y3,
                x, y, null
            );
            return d <= _l / 2;
        }

        /**
         * 二次贝塞尔曲线描边包含判断
         * @param  {number}  x0
         * @param  {number}  y0
         * @param  {number}  x1
         * @param  {number}  y1
         * @param  {number}  x2
         * @param  {number}  y2
         * @param  {number}  lineWidth
         * @param  {number}  x
         * @param  {number}  y
         * @return {boolean}
         */
        function isInsideQuadraticStroke(
            x0, y0, x1, y1, x2, y2,
            lineWidth, x, y
        ) {
            if (lineWidth === 0) {
                return false;
            }
            var _l = Math.max(lineWidth, 5);
            // Quick reject
            if (
                (y > y0 + _l && y > y1 + _l && y > y2 + _l)
                || (y < y0 - _l && y < y1 - _l && y < y2 - _l)
                || (x > x0 + _l && x > x1 + _l && x > x2 + _l)
                || (x < x0 - _l && x < x1 - _l && x < x2 - _l)
            ) {
                return false;
            }
            var d =  curve.quadraticProjectPoint(
                x0, y0, x1, y1, x2, y2,
                x, y, null
            );
            return d <= _l / 2;
        }

        /**
         * 圆弧描边包含判断
         * @param  {number}  cx
         * @param  {number}  cy
         * @param  {number}  r
         * @param  {number}  startAngle
         * @param  {number}  endAngle
         * @param  {boolean}  anticlockwise
         * @param  {number} lineWidth
         * @param  {number}  x
         * @param  {number}  y
         * @return {Boolean}
         */
        function isInsideArcStroke(
            cx, cy, r, startAngle, endAngle, anticlockwise,
            lineWidth, x, y
        ) {
            if (lineWidth === 0) {
                return false;
            }
            var _l = Math.max(lineWidth, 5);

            x -= cx;
            y -= cy;
            var d = Math.sqrt(x * x + y * y);
            if ((d - _l > r) || (d + _l < r)) {
                return false;
            }
            if (Math.abs(startAngle - endAngle) >= PI2) {
                // Is a circle
                return true;
            }
            if (anticlockwise) {
                var tmp = startAngle;
                startAngle = normalizeRadian(endAngle);
                endAngle = normalizeRadian(tmp);
            } else {
                startAngle = normalizeRadian(startAngle);
                endAngle = normalizeRadian(endAngle);
            }
            if (startAngle > endAngle) {
                endAngle += PI2;
            }
            
            var angle = Math.atan2(y, x);
            if (angle < 0) {
                angle += PI2;
            }
            return (angle >= startAngle && angle <= endAngle)
                || (angle + PI2 >= startAngle && angle + PI2 <= endAngle);
        }

        function isInsidePolyline(points, lineWidth, x, y) {
            var lineWidth = Math.max(lineWidth, 10);
            for (var i = 0, l = points.length - 1; i < l; i++) {
                var x0 = points[i][0];
                var y0 = points[i][1];
                var x1 = points[i + 1][0];
                var y1 = points[i + 1][1];

                if (isInsideLine(x0, y0, x1, y1, lineWidth, x, y)) {
                    return true;
                }
            }

            return false;
        }

        function isInsideRing(cx, cy, r0, r, x, y) {
            var d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            return (d < r * r) && (d > r0 * r0);
        }

        /**
         * 矩形包含判断
         */
        function isInsideRect(x0, y0, width, height, x, y) {
            return x >= x0 && x <= (x0 + width)
                && y >= y0 && y <= (y0 + height);
        }

        /**
         * 圆形包含判断
         */
        function isInsideCircle(x0, y0, r, x, y) {
            return (x - x0) * (x - x0) + (y - y0) * (y - y0)
                   < r * r;
        }

        /**
         * 扇形包含判断
         */
        function isInsideSector(
            cx, cy, r0, r, startAngle, endAngle, anticlockwise, x, y
        ) {
            return isInsideArcStroke(
                cx, cy, (r0 + r) / 2, startAngle, endAngle, anticlockwise,
                r - r0, x, y
            );
        }

        /**
         * 多边形包含判断
         * 与 canvas 一样采用 non-zero winding rule
         */
        function isInsidePolygon(points, x, y) {
            var N = points.length;
            var w = 0;

            for (var i = 0, j = N - 1; i < N; i++) {
                var x0 = points[j][0];
                var y0 = points[j][1];
                var x1 = points[i][0];
                var y1 = points[i][1];
                w += windingLine(x0, y0, x1, y1, x, y);
                j = i;
            }
            return w !== 0;
        }

        function windingLine(x0, y0, x1, y1, x, y) {
            if ((y > y0 && y > y1) || (y < y0 && y < y1)) {
                return 0;
            }
            if (y1 == y0) {
                return 0;
            }
            var dir = y1 < y0 ? 1 : -1;
            var t = (y - y0) / (y1 - y0);
            var x_ = t * (x1 - x0) + x0;

            return x_ > x ? dir : 0;
        }

        // 临时数组
        var roots = [-1, -1, -1];
        var extrema = [-1, -1];

        function swapExtrema() {
            var tmp = extrema[0];
            extrema[0] = extrema[1];
            extrema[1] = tmp;
        }
        function windingCubic(x0, y0, x1, y1, x2, y2, x3, y3, x, y) {
            // Quick reject
            if (
                (y > y0 && y > y1 && y > y2 && y > y3)
                || (y < y0 && y < y1 && y < y2 && y < y3)
            ) {
                return 0;
            }
            var nRoots = curve.cubicRootAt(y0, y1, y2, y3, y, roots);
            if (nRoots === 0) {
                return 0;
            }
            else {
                var w = 0;
                var nExtrema = -1;
                var y0_, y1_;
                for (var i = 0; i < nRoots; i++) {
                    var t = roots[i];
                    var x_ = curve.cubicAt(x0, x1, x2, x3, t);
                    if (x_ < x) { // Quick reject
                        continue;
                    }
                    if (nExtrema < 0) {
                        nExtrema = curve.cubicExtrema(y0, y1, y2, y3, extrema);
                        if (extrema[1] < extrema[0] && nExtrema > 1) {
                            swapExtrema();
                        }
                        y0_ = curve.cubicAt(y0, y1, y2, y3, extrema[0]);
                        if (nExtrema > 1) {
                            y1_ = curve.cubicAt(y0, y1, y2, y3, extrema[1]);
                        }
                    }
                    if (nExtrema == 2) {
                        // 分成三段单调函数
                        if (t < extrema[0]) {
                            w += y0_ < y0 ? 1 : -1;
                        } 
                        else if (t < extrema[1]) {
                            w += y1_ < y0_ ? 1 : -1;
                        } 
                        else {
                            w += y3 < y1_ ? 1 : -1;
                        }
                    } 
                    else {
                        // 分成两段单调函数
                        if (t < extrema[0]) {
                            w += y0_ < y0 ? 1 : -1;
                        } 
                        else {
                            w += y3 < y0_ ? 1 : -1;
                        }
                    }
                }
                return w;
            }
        }

        function windingQuadratic(x0, y0, x1, y1, x2, y2, x, y) {
            // Quick reject
            if (
                (y > y0 && y > y1 && y > y2)
                || (y < y0 && y < y1 && y < y2)
            ) {
                return 0;
            }
            var nRoots = curve.quadraticRootAt(y0, y1, y2, y, roots);
            if (nRoots === 0) {
                return 0;
            } 
            else {
                var t = curve.quadraticExtremum(y0, y1, y2);
                if (t >=0 && t <= 1) {
                    var w = 0;
                    var y_ = curve.quadraticAt(y0, y1, y2, t);
                    for (var i = 0; i < nRoots; i++) {
                        var x_ = curve.quadraticAt(x0, x1, x2, roots[i]);
                        if (x_ < x) {
                            continue;
                        }
                        if (roots[i] < t) {
                            w += y_ < y0 ? 1 : -1;
                        } 
                        else {
                            w += y2 < y_ ? 1 : -1;
                        }
                    }
                    return w;
                } 
                else {
                    var x_ = curve.quadraticAt(x0, x1, x2, roots[0]);
                    if (x_ < x) {
                        return 0;
                    }
                    return y2 < y0 ? 1 : -1;
                }
            }
        }
        
        // TODO
        // Arc 旋转
        function windingArc(
            cx, cy, r, startAngle, endAngle, anticlockwise, x, y
        ) {
            y -= cy;
            if (y > r || y < -r) {
                return 0;
            }
            var tmp = Math.sqrt(r * r - y * y);
            roots[0] = -tmp;
            roots[1] = tmp;

            if (Math.abs(startAngle - endAngle) >= PI2) {
                // Is a circle
                startAngle = 0;
                endAngle = PI2;
                var dir = anticlockwise ? 1 : -1;
                if (x >= roots[0] + cx && x <= roots[1] + cx) {
                    return dir;
                } else {
                    return 0;
                }
            }

            if (anticlockwise) {
                var tmp = startAngle;
                startAngle = normalizeRadian(endAngle);
                endAngle = normalizeRadian(tmp);   
            } else {
                startAngle = normalizeRadian(startAngle);
                endAngle = normalizeRadian(endAngle);   
            }
            if (startAngle > endAngle) {
                endAngle += PI2;
            }

            var w = 0;
            for (var i = 0; i < 2; i++) {
                var x_ = roots[i];
                if (x_ + cx > x) {
                    var angle = Math.atan2(y, x_);
                    var dir = anticlockwise ? 1 : -1;
                    if (angle < 0) {
                        angle = PI2 + angle;
                    }
                    if (
                        (angle >= startAngle && angle <= endAngle)
                        || (angle + PI2 >= startAngle && angle + PI2 <= endAngle)
                    ) {
                        if (angle > Math.PI / 2 && angle < Math.PI * 1.5) {
                            dir = -dir;
                        }
                        w += dir;
                    }
                }
            }
            return w;
        }

        /**
         * 路径包含判断
         * 与 canvas 一样采用 non-zero winding rule
         */
        function isInsidePath(pathArray, lineWidth, brushType, x, y) {
            var w = 0;
            var xi = 0;
            var yi = 0;
            var x0 = 0;
            var y0 = 0;
            var beginSubpath = true;
            var firstCmd = true;

            brushType = brushType || 'fill';

            var hasStroke = brushType === 'stroke' || brushType === 'both';
            var hasFill = brushType === 'fill' || brushType === 'both';

            // var roots = [-1, -1, -1];
            for (var i = 0; i < pathArray.length; i++) {
                var seg = pathArray[i];
                var p = seg.points;
                // Begin a new subpath
                if (beginSubpath || seg.command === 'M') {
                    if (i > 0) {
                        // Close previous subpath
                        if (hasFill) {
                            w += windingLine(xi, yi, x0, y0, x, y);
                        }
                        if (w !== 0) {
                            return true;
                        }
                    }
                    x0 = p[p.length - 2];
                    y0 = p[p.length - 1];
                    beginSubpath = false;
                    if (firstCmd && seg.command !== 'A') {
                        // 如果第一个命令不是M, 是lineTo, bezierCurveTo
                        // 等绘制命令的话，是会从该绘制的起点开始算的
                        // Arc 会在之后做单独处理所以这里忽略
                        firstCmd = false;
                        xi = x0;
                        yi = y0;
                    }
                }
                switch (seg.command) {
                    case 'M':
                        xi = p[0];
                        yi = p[1];
                        break;
                    case 'L':
                        if (hasStroke) {
                            if (isInsideLine(
                                xi, yi, p[0], p[1], lineWidth, x, y
                            )) {
                                return true;
                            }
                        }
                        if (hasFill) {
                            w += windingLine(xi, yi, p[0], p[1], x, y);
                        }
                        xi = p[0];
                        yi = p[1];
                        break;
                    case 'C':
                        if (hasStroke) {
                            if (isInsideCubicStroke(
                                xi, yi, p[0], p[1], p[2], p[3], p[4], p[5],
                                lineWidth, x, y
                            )) {
                                return true;
                            }
                        }
                        if (hasFill) {
                            w += windingCubic(
                                xi, yi, p[0], p[1], p[2], p[3], p[4], p[5], x, y
                            );
                        }
                        xi = p[4];
                        yi = p[5];
                        break;
                    case 'Q':
                        if (hasStroke) {
                            if (isInsideQuadraticStroke(
                                xi, yi, p[0], p[1], p[2], p[3],
                                lineWidth, x, y
                            )) {
                                return true;
                            }
                        }
                        if (hasFill) {
                            w += windingQuadratic(
                                xi, yi, p[0], p[1], p[2], p[3], x, y
                            );
                        }
                        xi = p[2];
                        yi = p[3];
                        break;
                    case 'A':
                        // TODO Arc 旋转
                        // TODO Arc 判断的开销比较大
                        var cx = p[0];
                        var cy = p[1];
                        var rx = p[2];
                        var ry = p[3];
                        var theta = p[4];
                        var dTheta = p[5];
                        var x1 = Math.cos(theta) * rx + cx;
                        var y1 = Math.sin(theta) * ry + cy;
                        // 不是直接使用 arc 命令
                        if (!firstCmd) {
                            w += windingLine(xi, yi, x1, y1);
                        } else {
                            firstCmd = false;
                            // 第一个命令起点还未定义
                            x0 = x1;
                            y0 = y1;
                        }
                        // zr 使用scale来模拟椭圆, 这里也对x做一定的缩放
                        var _x = (x - cx) * ry / rx + cx;
                        if (hasStroke) {
                            if (isInsideArcStroke(
                                cx, cy, ry, theta, theta + dTheta, 1 - p[7],
                                lineWidth, _x, y
                            )) {
                                return true;
                            }
                        }
                        if (hasFill) {
                            w += windingArc(
                                cx, cy, ry, theta, theta + dTheta, 1 - p[7],
                                _x, y
                            );
                        }
                        xi = Math.cos(theta + dTheta) * rx + cx;
                        yi = Math.sin(theta + dTheta) * ry + cy;
                        break;
                    case 'z':
                        if (hasStroke) {
                            if (isInsideLine(
                                xi, yi, x0, y0, lineWidth, x, y
                            )) {
                                return true;
                            }
                        }
                        beginSubpath = true;
                        break;
                }
            }
            if (hasFill) {
                w += windingLine(xi, yi, x0, y0, x, y);
            }
            return w !== 0;
        }

        /**
         * 测算多行文本宽度
         * @param {Object} text
         * @param {Object} textFont
         */
        function getTextWidth(text, textFont) {
            var key = text + ':' + textFont;
            if (_textWidthCache[key]) {
                return _textWidthCache[key];
            }
            _ctx = _ctx || util.getContext();
            _ctx.save();

            if (textFont) {
                _ctx.font = textFont;
            }
            
            text = (text + '').split('\n');
            var width = 0;
            for (var i = 0, l = text.length; i < l; i++) {
                width =  Math.max(
                    _ctx.measureText(text[i]).width,
                    width
                );
            }
            _ctx.restore();

            _textWidthCache[key] = width;
            if (++_textWidthCacheCounter > TEXT_CACHE_MAX) {
                // 内存释放
                _textWidthCacheCounter = 0;
                _textWidthCache = {};
            }
            
            return width;
        }
        
        /**
         * 测算多行文本高度
         * @param {Object} text
         * @param {Object} textFont
         */
        function getTextHeight(text, textFont) {
            var key = text + ':' + textFont;
            if (_textHeightCache[key]) {
                return _textHeightCache[key];
            }
            
            _ctx = _ctx || util.getContext();

            _ctx.save();
            if (textFont) {
                _ctx.font = textFont;
            }
            
            text = (text + '').split('\n');
            // 比较粗暴
            var height = (_ctx.measureText('国').width + 2) * text.length;

            _ctx.restore();

            _textHeightCache[key] = height;
            if (++_textHeightCacheCounter > TEXT_CACHE_MAX) {
                // 内存释放
                _textHeightCacheCounter = 0;
                _textHeightCache = {};
            }
            return height;
        }

        return {
            isInside : isInside,
            isOutside : isOutside,
            getTextWidth : getTextWidth,
            getTextHeight : getTextHeight,

            isInsidePath: isInsidePath,
            isInsidePolygon: isInsidePolygon,
            isInsideSector: isInsideSector,
            isInsideCircle: isInsideCircle,
            isInsideLine: isInsideLine,
            isInsideRect: isInsideRect,
            isInsidePolyline: isInsidePolyline,

            isInsideCubicStroke: isInsideCubicStroke,
            isInsideQuadraticStroke: isInsideQuadraticStroke
        };
    });
define('zrender/mixin/Eventful', ['require'], function (require) {

    /**
     * 事件分发器
     * @alias module:zrender/mixin/Eventful
     * @constructor
     */
    var Eventful = function () {
        this._handlers = {};
    };
    /**
     * 单次触发绑定，dispatch后销毁
     * 
     * @param {string} event 事件名
     * @param {Function} handler 响应函数
     * @param {Object} context
     */
    Eventful.prototype.one = function (event, handler, context) {
        var _h = this._handlers;

        if (!handler || !event) {
            return this;
        }

        if (!_h[event]) {
            _h[event] = [];
        }

        _h[event].push({
            h : handler,
            one : true,
            ctx: context || this
        });

        return this;
    };

    /**
     * 绑定事件
     * @param {string} event 事件名
     * @param {Function} handler 事件处理函数
     * @param {Object} [context]
     */
    Eventful.prototype.bind = function (event, handler, context) {
        var _h = this._handlers;

        if (!handler || !event) {
            return this;
        }

        if (!_h[event]) {
            _h[event] = [];
        }

        _h[event].push({
            h : handler,
            one : false,
            ctx: context || this
        });

        return this;
    };

    /**
     * 解绑事件
     * @param {string} event 事件名
     * @param {Function} [handler] 事件处理函数
     */
    Eventful.prototype.unbind = function (event, handler) {
        var _h = this._handlers;

        if (!event) {
            this._handlers = {};
            return this;
        }

        if (handler) {
            if (_h[event]) {
                var newList = [];
                for (var i = 0, l = _h[event].length; i < l; i++) {
                    if (_h[event][i]['h'] != handler) {
                        newList.push(_h[event][i]);
                    }
                }
                _h[event] = newList;
            }

            if (_h[event] && _h[event].length === 0) {
                delete _h[event];
            }
        }
        else {
            delete _h[event];
        }

        return this;
    };

    /**
     * 事件分发
     * 
     * @param {string} type 事件类型
     */
    Eventful.prototype.dispatch = function (type) {
        if (this._handlers[type]) {
            var args = arguments;
            var argLen = args.length;

            if (argLen > 3) {
                args = Array.prototype.slice.call(args, 1);
            }
            
            var _h = this._handlers[type];
            var len = _h.length;
            for (var i = 0; i < len;) {
                // Optimize advise from backbone
                switch (argLen) {
                    case 1:
                        _h[i]['h'].call(_h[i]['ctx']);
                        break;
                    case 2:
                        _h[i]['h'].call(_h[i]['ctx'], args[1]);
                        break;
                    case 3:
                        _h[i]['h'].call(_h[i]['ctx'], args[1], args[2]);
                        break;
                    default:
                        // have more than 2 given arguments
                        _h[i]['h'].apply(_h[i]['ctx'], args);
                        break;
                }
                
                if (_h[i]['one']) {
                    _h.splice(i, 1);
                    len--;
                }
                else {
                    i++;
                }
            }
        }

        return this;
    };

    /**
     * 带有context的事件分发, 最后一个参数是事件回调的context
     * @param {string} type 事件类型
     */
    Eventful.prototype.dispatchWithContext = function (type) {
        if (this._handlers[type]) {
            var args = arguments;
            var argLen = args.length;

            if (argLen > 4) {
                args = Array.prototype.slice.call(args, 1, args.length - 1);
            }
            var ctx = args[args.length - 1];

            var _h = this._handlers[type];
            var len = _h.length;
            for (var i = 0; i < len;) {
                // Optimize advise from backbone
                switch (argLen) {
                    case 1:
                        _h[i]['h'].call(ctx);
                        break;
                    case 2:
                        _h[i]['h'].call(ctx, args[1]);
                        break;
                    case 3:
                        _h[i]['h'].call(ctx, args[1], args[2]);
                        break;
                    default:
                        // have more than 2 given arguments
                        _h[i]['h'].apply(ctx, args);
                        break;
                }
                
                if (_h[i]['one']) {
                    _h.splice(i, 1);
                    len--;
                }
                else {
                    i++;
                }
            }
        }

        return this;
    };

    // 对象可以通过 onxxxx 绑定事件
    /**
     * @event module:zrender/mixin/Eventful#onclick
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#onmouseover
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#onmouseout
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#onmousemove
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#onmousewheel
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#onmousedown
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#onmouseup
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#ondragstart
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#ondragend
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#ondragenter
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#ondragleave
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#ondragover
     * @type {Function}
     * @default null
     */
    /**
     * @event module:zrender/mixin/Eventful#ondrop
     * @type {Function}
     * @default null
     */
    
    return Eventful;
});
define('zrender/shape/Base', ['require', '../tool/matrix', '../tool/guid', '../tool/util', '../tool/log', '../mixin/Transformable', '../mixin/Eventful', '../tool/area', '../tool/color'], function (require) {
        var vmlCanvasManager = window['G_vmlCanvasManager'];

        var matrix = require('../tool/matrix');
        var guid = require('../tool/guid');
        var util = require('../tool/util');
        var log = require('../tool/log');

        var Transformable = require('../mixin/Transformable');
        var Eventful = require('../mixin/Eventful');

        function _fillText(ctx, text, x, y, textFont, textAlign, textBaseline) {
            if (textFont) {
                ctx.font = textFont;
            }
            ctx.textAlign = textAlign;
            ctx.textBaseline = textBaseline;
            var rect = _getTextRect(
                text, x, y, textFont, textAlign, textBaseline
            );
            
            text = (text + '').split('\n');
            var lineHeight = require('../tool/area').getTextHeight('国', textFont);
            
            switch (textBaseline) {
                case 'top':
                    y = rect.y;
                    break;
                case 'bottom':
                    y = rect.y + lineHeight;
                    break;
                default:
                    y = rect.y + lineHeight / 2;
            }
            
            for (var i = 0, l = text.length; i < l; i++) {
                ctx.fillText(text[i], x, y);
                y += lineHeight;
            }
        }

        /**
         * 返回矩形区域，用于局部刷新和文字定位
         * @inner
         * @param {string} text
         * @param {number} x
         * @param {number} y
         * @param {string} textFont
         * @param {string} textAlign
         * @param {string} textBaseline
         */
        function _getTextRect(text, x, y, textFont, textAlign, textBaseline) {
            var area = require('../tool/area');
            var width = area.getTextWidth(text, textFont);
            var lineHeight = area.getTextHeight('国', textFont);
            
            text = (text + '').split('\n');
            
            switch (textAlign) {
                case 'end':
                case 'right':
                    x -= width;
                    break;
                case 'center':
                    x -= (width / 2);
                    break;
            }

            switch (textBaseline) {
                case 'top':
                    break;
                case 'bottom':
                    y -= lineHeight * text.length;
                    break;
                default:
                    y -= lineHeight * text.length / 2;
            }

            return {
                x : x,
                y : y,
                width : width,
                height : lineHeight * text.length
            };
        }

        /**
         * @alias module:zrender/shape/Base
         * @constructor
         * @extends module:zrender/mixin/Transformable
         * @extends module:zrender/mixin/Eventful
         * @param {Object} options 关于shape的配置项，可以是shape的自有属性，也可以是自定义的属性。
         */
        var Base = function(options) {
            
            options = options || {};
            
            /**
             * Shape id, 全局唯一
             * @type {string}
             */
            this.id = options.id || guid();

            for (var key in options) {
                this[key] = options[key];
            }

            /**
             * 基础绘制样式
             * @type {module:zrender/shape/Base~IBaseShapeStyle}
             */
            this.style = this.style || {};

            /**
             * 高亮样式
             * @type {module:zrender/shape/Base~IBaseShapeStyle}
             */
            this.highlightStyle = this.highlightStyle || null;

            /**
             * 父节点
             * @readonly
             * @type {module:zrender/Group}
             * @default null
             */
            this.parent = null;

            this.__dirty = true;

            this.__clipShapes = [];

            Transformable.call(this);
            Eventful.call(this);
        };
        /**
         * 图形是否可见，为true时不绘制图形，但是仍能触发鼠标事件
         * @name module:zrender/shape/Base#invisible
         * @type {boolean}
         * @default false
         */
        Base.prototype.invisible = false;

        /**
         * 图形是否忽略，为true时忽略图形的绘制以及事件触发
         * @name module:zrender/shape/Base#ignore
         * @type {boolean}
         * @default false
         */
        Base.prototype.ignore = false;

        /**
         * z层level，决定绘画在哪层canvas中
         * @name module:zrender/shape/Base#zlevel
         * @type {number}
         * @default 0
         */
        Base.prototype.zlevel = 0;

        /**
         * 是否可拖拽
         * @name module:zrender/shape/Base#draggable
         * @type {boolean}
         * @default false
         */
        Base.prototype.draggable = false;

        /**
         * 是否可点击
         * @name module:zrender/shape/Base#clickable
         * @type {boolean}
         * @default false
         */
        Base.prototype.clickable = false;

        /**
         * 是否可以hover
         * @name module:zrender/shape/Base#hoverable
         * @type {boolean}
         * @default true
         */
        Base.prototype.hoverable = true;
        
        /**
         * z值，跟zlevel一样影响shape绘制的前后顺序，z值大的shape会覆盖在z值小的上面，
         * 但是并不会创建新的canvas，所以优先级低于zlevel，而且频繁改动的开销比zlevel小很多。
         * 
         * @name module:zrender/shape/Base#z
         * @type {number}
         * @default 0
         */
        Base.prototype.z = 0;

        /**
         * 绘制图形
         * 
         * @param {CanvasRenderingContext2D} ctx
         * @param {boolean} [isHighlight=false] 是否使用高亮属性
         * @param {Function} [updateCallback]
         *        需要异步加载资源的shape可以通过这个callback(e), 
         *        让painter更新视图，base.brush没用，需要的话重载brush
         */
        Base.prototype.brush = function (ctx, isHighlight) {

            var style = this.beforeBrush(ctx, isHighlight);

            ctx.beginPath();
            this.buildPath(ctx, style);

            switch (style.brushType) {
                /* jshint ignore:start */
                case 'both':
                    ctx.fill();
                case 'stroke':
                    style.lineWidth > 0 && ctx.stroke();
                    break;
                /* jshint ignore:end */
                default:
                    ctx.fill();
            }
            
            this.drawText(ctx, style, this.style);

            this.afterBrush(ctx);
        };

        /**
         * 具体绘制操作前的一些公共操作
         * @param {CanvasRenderingContext2D} ctx
         * @param {boolean} [isHighlight=false] 是否使用高亮属性
         * @return {Object} 处理后的样式
         */
        Base.prototype.beforeBrush = function (ctx, isHighlight) {
            var style = this.style;
            
            if (this.brushTypeOnly) {
                style.brushType = this.brushTypeOnly;
            }

            if (isHighlight) {
                // 根据style扩展默认高亮样式
                style = this.getHighlightStyle(
                    style,
                    this.highlightStyle || {},
                    this.brushTypeOnly
                );
            }

            if (this.brushTypeOnly == 'stroke') {
                style.strokeColor = style.strokeColor || style.color;
            }

            ctx.save();

            this.doClip(ctx);

            this.setContext(ctx, style);

            // 设置transform
            this.setTransform(ctx);

            return style;
        };

        /**
         * 绘制后的处理
         * @param {CanvasRenderingContext2D} ctx
         */
        Base.prototype.afterBrush = function (ctx) {
            ctx.restore();
        };

        var STYLE_CTX_MAP = [
            [ 'color', 'fillStyle' ],
            [ 'strokeColor', 'strokeStyle' ],
            [ 'opacity', 'globalAlpha' ],
            [ 'lineCap', 'lineCap' ],
            [ 'lineJoin', 'lineJoin' ],
            [ 'miterLimit', 'miterLimit' ],
            [ 'lineWidth', 'lineWidth' ],
            [ 'shadowBlur', 'shadowBlur' ],
            [ 'shadowColor', 'shadowColor' ],
            [ 'shadowOffsetX', 'shadowOffsetX' ],
            [ 'shadowOffsetY', 'shadowOffsetY' ]
        ];

        /**
         * 设置 fillStyle, strokeStyle, shadow 等通用绘制样式
         * @param {CanvasRenderingContext2D} ctx
         * @param {module:zrender/shape/Base~IBaseShapeStyle} style
         */
        Base.prototype.setContext = function (ctx, style) {
            for (var i = 0, len = STYLE_CTX_MAP.length; i < len; i++) {
                var styleProp = STYLE_CTX_MAP[i][0];
                var styleValue = style[styleProp];
                var ctxProp = STYLE_CTX_MAP[i][1];

                if (typeof styleValue != 'undefined') {
                    ctx[ctxProp] = styleValue;
                }
            }
        };

        var clipShapeInvTransform = matrix.create();
        Base.prototype.doClip = function (ctx) {
            if (this.__clipShapes && !vmlCanvasManager) {
                for (var i = 0; i < this.__clipShapes.length; i++) {
                    var clipShape = this.__clipShapes[i];
                    if (clipShape.needTransform) {
                        var m = clipShape.transform;
                        matrix.invert(clipShapeInvTransform, m);
                        ctx.transform(
                            m[0], m[1],
                            m[2], m[3],
                            m[4], m[5]
                        );
                    }
                    ctx.beginPath();
                    clipShape.buildPath(ctx, clipShape.style);
                    ctx.clip();
                    // Transform back
                    if (clipShape.needTransform) {
                        var m = clipShapeInvTransform;
                        ctx.transform(
                            m[0], m[1],
                            m[2], m[3],
                            m[4], m[5]
                        );
                    }
                }
            }
        };
    
        /**
         * 根据默认样式扩展高亮样式
         * 
         * @param {module:zrender/shape/Base~IBaseShapeStyle} style 默认样式
         * @param {module:zrender/shape/Base~IBaseShapeStyle} highlightStyle 高亮样式
         * @param {string} brushTypeOnly
         */
        Base.prototype.getHighlightStyle = function (style, highlightStyle, brushTypeOnly) {
            var newStyle = {};
            for (var k in style) {
                newStyle[k] = style[k];
            }

            var color = require('../tool/color');
            var highlightColor = color.getHighlightColor();
            // 根据highlightStyle扩展
            if (style.brushType != 'stroke') {
                // 带填充则用高亮色加粗边线
                newStyle.strokeColor = highlightColor;
                newStyle.lineWidth = (style.lineWidth || 1)
                                      + this.getHighlightZoom();
                newStyle.brushType = 'both';
            }
            else {
                if (brushTypeOnly != 'stroke') {
                    // 描边型的则用原色加工高亮
                    newStyle.strokeColor = highlightColor;
                    newStyle.lineWidth = (style.lineWidth || 1)
                                          + this.getHighlightZoom();
                } 
                else {
                    // 线型的则用原色加工高亮
                    newStyle.strokeColor = highlightStyle.strokeColor
                                           || color.mix(
                                                 style.strokeColor,
                                                 color.toRGB(highlightColor)
                                              );
                }
            }

            // 可自定义覆盖默认值
            for (var k in highlightStyle) {
                if (typeof highlightStyle[k] != 'undefined') {
                    newStyle[k] = highlightStyle[k];
                }
            }

            return newStyle;
        };

        // 高亮放大效果参数
        // 当前统一设置为6，如有需要差异设置，通过this.type判断实例类型
        Base.prototype.getHighlightZoom = function () {
            return this.type != 'text' ? 6 : 2;
        };

        /**
         * 移动位置
         * @param {number} dx 横坐标变化
         * @param {number} dy 纵坐标变化
         */
        Base.prototype.drift = function (dx, dy) {
            this.position[0] += dx;
            this.position[1] += dy;
        };

        /**
         * 构建绘制的Path
         * @param {CanvasRenderingContext2D} ctx
         * @param {module:zrender/shape/Base~IBaseShapeStyle} style
         */
        Base.prototype.buildPath = function (ctx, style) {
            log('buildPath not implemented in ' + this.type);
        };

        /**
         * 计算返回包围盒矩形
         * @param {module:zrender/shape/Base~IBaseShapeStyle} style
         * @return {module:zrender/shape/Base~IBoundingRect}
         */
        Base.prototype.getRect = function (style) {
            log('getRect not implemented in ' + this.type);   
        };
        
        /**
         * 判断鼠标位置是否在图形内
         * @param {number} x
         * @param {number} y
         * @return {boolean}
         */
        Base.prototype.isCover = function (x, y) {
            var originPos = this.transformCoordToLocal(x, y);
            x = originPos[0];
            y = originPos[1];

            // 快速预判并保留判断矩形
            if (this.isCoverRect(x, y)) {
                // 矩形内
                return require('../tool/area').isInside(this, this.style, x, y);
            }
            
            return false;
        };

        Base.prototype.isCoverRect = function (x, y) {
            // 快速预判并保留判断矩形
            var rect = this.style.__rect;
            if (!rect) {
                rect = this.style.__rect = this.getRect(this.style);
            }
            return x >= rect.x
                && x <= (rect.x + rect.width)
                && y >= rect.y
                && y <= (rect.y + rect.height);
        };

        /**
         * 绘制附加文本
         * @param {CanvasRenderingContext2D} ctx
         * @param {module:zrender/shape/Base~IBaseShapeStyle} style 样式
         * @param {module:zrender/shape/Base~IBaseShapeStyle} normalStyle 默认样式，用于定位文字显示
         */
        Base.prototype.drawText = function (ctx, style, normalStyle) {
            if (typeof(style.text) == 'undefined' || style.text === false) {
                return;
            }
            // 字体颜色策略
            var textColor = style.textColor || style.color || style.strokeColor;
            ctx.fillStyle = textColor;

            // 文本与图形间空白间隙
            var dd = 10;
            var al;         // 文本水平对齐
            var bl;         // 文本垂直对齐
            var tx;         // 文本横坐标
            var ty;         // 文本纵坐标

            var textPosition = style.textPosition       // 用户定义
                               || this.textPosition     // shape默认
                               || 'top';                // 全局默认

            switch (textPosition) {
                case 'inside': 
                case 'top': 
                case 'bottom': 
                case 'left': 
                case 'right': 
                    if (this.getRect) {
                        var rect = (normalStyle || style).__rect
                                   || this.getRect(normalStyle || style);

                        switch (textPosition) {
                            case 'inside':
                                tx = rect.x + rect.width / 2;
                                ty = rect.y + rect.height / 2;
                                al = 'center';
                                bl = 'middle';
                                if (style.brushType != 'stroke'
                                    && textColor == style.color
                                ) {
                                    ctx.fillStyle = '#fff';
                                }
                                break;
                            case 'left':
                                tx = rect.x - dd;
                                ty = rect.y + rect.height / 2;
                                al = 'end';
                                bl = 'middle';
                                break;
                            case 'right':
                                tx = rect.x + rect.width + dd;
                                ty = rect.y + rect.height / 2;
                                al = 'start';
                                bl = 'middle';
                                break;
                            case 'top':
                                tx = rect.x + rect.width / 2;
                                ty = rect.y - dd;
                                al = 'center';
                                bl = 'bottom';
                                break;
                            case 'bottom':
                                tx = rect.x + rect.width / 2;
                                ty = rect.y + rect.height + dd;
                                al = 'center';
                                bl = 'top';
                                break;
                        }
                    }
                    break;
                case 'start':
                case 'end':
                    var pointList = style.pointList
                                    || [
                                        [style.xStart || 0, style.yStart || 0],
                                        [style.xEnd || 0, style.yEnd || 0]
                                    ];
                    var length = pointList.length;
                    if (length < 2) {
                        // 少于2个点就不画了~
                        return;
                    }
                    var xStart;
                    var xEnd;
                    var yStart;
                    var yEnd;
                    switch (textPosition) {
                        case 'start':
                            xStart = pointList[1][0];
                            xEnd = pointList[0][0];
                            yStart = pointList[1][1];
                            yEnd = pointList[0][1];
                            break;
                        case 'end':
                            xStart = pointList[length - 2][0];
                            xEnd = pointList[length - 1][0];
                            yStart = pointList[length - 2][1];
                            yEnd = pointList[length - 1][1];
                            break;
                    }
                    tx = xEnd;
                    ty = yEnd;
                    
                    var angle = Math.atan((yStart - yEnd) / (xEnd - xStart)) / Math.PI * 180;
                    if ((xEnd - xStart) < 0) {
                        angle += 180;
                    }
                    else if ((yStart - yEnd) < 0) {
                        angle += 360;
                    }
                    
                    dd = 5;
                    if (angle >= 30 && angle <= 150) {
                        al = 'center';
                        bl = 'bottom';
                        ty -= dd;
                    }
                    else if (angle > 150 && angle < 210) {
                        al = 'right';
                        bl = 'middle';
                        tx -= dd;
                    }
                    else if (angle >= 210 && angle <= 330) {
                        al = 'center';
                        bl = 'top';
                        ty += dd;
                    }
                    else {
                        al = 'left';
                        bl = 'middle';
                        tx += dd;
                    }
                    break;
                case 'specific':
                    tx = style.textX || 0;
                    ty = style.textY || 0;
                    al = 'start';
                    bl = 'middle';
                    break;
            }

            if (tx != null && ty != null) {
                _fillText(
                    ctx,
                    style.text, 
                    tx, ty, 
                    style.textFont,
                    style.textAlign || al,
                    style.textBaseline || bl
                );
            }
        };

        Base.prototype.modSelf = function() {
            this.__dirty = true;
            if (this.style) {
                this.style.__rect = null;
            }
            if (this.highlightStyle) {
                this.highlightStyle.__rect = null;
            }
        };

        /**
         * 图形是否会触发事件
         * @return {boolean}
         */
        // TODO, 通过 bind 绑定的事件
        Base.prototype.isSilent = function () {
            return !(
                this.hoverable || this.draggable || this.clickable
                || this.onmousemove || this.onmouseover || this.onmouseout
                || this.onmousedown || this.onmouseup || this.onclick
                || this.ondragenter || this.ondragover || this.ondragleave
                || this.ondrop
            );
        };

        util.merge(Base.prototype, Transformable.prototype, true);
        util.merge(Base.prototype, Eventful.prototype, true);

        return Base;
    });
define('zrender/tool/log', ['require', '../config'], function (require) {
        var config = require('../config');

        /**
         * @exports zrender/tool/log
         * @author Kener (@Kener-林峰, kener.linfeng@gmail.com)
         */
        return function() {
            if (config.debugMode === 0) {
                return;
            }
            else if (config.debugMode == 1) {
                for (var k in arguments) {
                    throw new Error(arguments[k]);
                }
            }
            else if (config.debugMode > 1) {
                for (var k in arguments) {
                    console.log(arguments[k]);
                }
            }
        };

        /* for debug
        return function(mes) {
            document.getElementById('wrong-message').innerHTML =
                mes + ' ' + (new Date() - 0)
                + '<br/>' 
                + document.getElementById('wrong-message').innerHTML;
        };
        */
    });
define('zrender/Storage', ['require', './tool/util', './Group'], function (require) {

        'use strict';

        var util = require('./tool/util');

        var Group = require('./Group');

        var defaultIterateOption = {
            hover: false,
            normal: 'down',
            update: false
        };

        function shapeCompareFunc(a, b) {
            if (a.zlevel == b.zlevel) {
                if (a.z == b.z) {
                    return a.__renderidx - b.__renderidx;
                }
                return a.z - b.z;
            }
            return a.zlevel - b.zlevel;
        }
        /**
         * 内容仓库 (M)
         * @alias module:zrender/Storage
         * @constructor
         */
        var Storage = function () {
            // 所有常规形状，id索引的map
            this._elements = {};

            // 高亮层形状，不稳定，动态增删，数组位置也是z轴方向，靠前显示在下方
            this._hoverElements = [];

            this._roots = [];

            this._shapeList = [];

            this._shapeListOffset = 0;
        };

        /**
         * 遍历迭代器
         * 
         * @param {Function} fun 迭代回调函数，return true终止迭代
         * @param {Object} [option] 迭代参数，缺省为仅降序遍历普通层图形
         * @param {boolean} [option.hover=true] 是否是高亮层图形
         * @param {string} [option.normal='up'] 是否是普通层图形，迭代时是否指定及z轴顺序
         * @param {boolean} [option.update=false] 是否在迭代前更新形状列表
         * 
         */
        Storage.prototype.iterShape = function (fun, option) {
            if (!option) {
                option = defaultIterateOption;
            }

            if (option.hover) {
                // 高亮层数据遍历
                for (var i = 0, l = this._hoverElements.length; i < l; i++) {
                    var el = this._hoverElements[i];
                    el.updateTransform();
                    if (fun(el)) {
                        return this;
                    }
                }
            }

            if (option.update) {
                this.updateShapeList();
            }

            // 遍历: 'down' | 'up'
            switch (option.normal) {
                case 'down':
                    // 降序遍历，高层优先
                    var l = this._shapeList.length;
                    while (l--) {
                        if (fun(this._shapeList[l])) {
                            return this;
                        }
                    }
                    break;
                // case 'up':
                default:
                    // 升序遍历，底层优先
                    for (var i = 0, l = this._shapeList.length; i < l; i++) {
                        if (fun(this._shapeList[i])) {
                            return this;
                        }
                    }
                    break;
            }

            return this;
        };

        /**
         * 返回hover层的形状数组
         * @param  {boolean} [update=false] 是否在返回前更新图形的变换
         * @return {Array.<module:zrender/shape/Base>}
         */
        Storage.prototype.getHoverShapes = function (update) {
            // hoverConnect
            var hoverElements = [];
            for (var i = 0, l = this._hoverElements.length; i < l; i++) {
                hoverElements.push(this._hoverElements[i]);
                var target = this._hoverElements[i].hoverConnect;
                if (target) {
                    var shape;
                    target = target instanceof Array ? target : [target];
                    for (var j = 0, k = target.length; j < k; j++) {
                        shape = target[j].id ? target[j] : this.get(target[j]);
                        if (shape) {
                            hoverElements.push(shape);
                        }
                    }
                }
            }
            hoverElements.sort(shapeCompareFunc);
            if (update) {
                for (var i = 0, l = hoverElements.length; i < l; i++) {
                    hoverElements[i].updateTransform();
                }
            }
            return hoverElements;
        };

        /**
         * 返回所有图形的绘制队列
         * @param  {boolean} [update=false] 是否在返回前更新该数组
         * 详见{@link module:zrender/shape/Base.prototype.updateShapeList}
         * @return {Array.<module:zrender/shape/Base>}
         */
        Storage.prototype.getShapeList = function (update) {
            if (update) {
                this.updateShapeList();
            }
            return this._shapeList;
        };

        /**
         * 更新图形的绘制队列。
         * 每次绘制前都会调用，该方法会先深度优先遍历整个树，更新所有Group和Shape的变换并且把所有可见的Shape保存到数组中，
         * 最后根据绘制的优先级（zlevel > z > 插入顺序）排序得到绘制队列
         */
        Storage.prototype.updateShapeList = function () {
            this._shapeListOffset = 0;
            for (var i = 0, len = this._roots.length; i < len; i++) {
                var root = this._roots[i];
                this._updateAndAddShape(root);
            }
            this._shapeList.length = this._shapeListOffset;

            for (var i = 0, len = this._shapeList.length; i < len; i++) {
                this._shapeList[i].__renderidx = i;
            }

            this._shapeList.sort(shapeCompareFunc);
        };

        Storage.prototype._updateAndAddShape = function (el, clipShapes) {
            
            if (el.ignore) {
                return;
            }

            el.updateTransform();

            if (el.clipShape) {
                // clipShape 的变换是基于 group 的变换
                el.clipShape.parent = el;
                el.clipShape.updateTransform();

                // PENDING 效率影响
                if (clipShapes) {
                    clipShapes = clipShapes.slice();
                    clipShapes.push(el.clipShape);
                } else {
                    clipShapes = [el.clipShape];
                }
            }

            if (el.type == 'group') {
                
                for (var i = 0; i < el._children.length; i++) {
                    var child = el._children[i];

                    // Force to mark as dirty if group is dirty
                    child.__dirty = el.__dirty || child.__dirty;

                    this._updateAndAddShape(child, clipShapes);
                }

                // Mark group clean here
                el.__dirty = false;
                
            }
            else {
                el.__clipShapes = clipShapes;

                this._shapeList[this._shapeListOffset++] = el;
            }
        };

        /**
         * 修改图形(Shape)或者组(Group)
         * 
         * @param {string|module:zrender/shape/Base|module:zrender/Group} el
         * @param {Object} [params] 参数
         */
        Storage.prototype.mod = function (el, params) {
            if (typeof (el) === 'string') {
                el = this._elements[el];
            }
            if (el) {

                el.modSelf();

                if (params) {
                    // 如果第二个参数直接使用 shape
                    // parent, _storage, __clipShapes 三个属性会有循环引用
                    // 主要为了向 1.x 版本兼容，2.x 版本不建议使用第二个参数
                    if (params.parent || params._storage || params.__clipShapes) {
                        var target = {};
                        for (var name in params) {
                            if (
                                name === 'parent'
                                || name === '_storage'
                                || name === '__clipShapes'
                            ) {
                                continue;
                            }
                            if (params.hasOwnProperty(name)) {
                                target[name] = params[name];
                            }
                        }
                        util.merge(el, target, true);
                    }
                    else {
                        util.merge(el, params, true);
                    }
                }
            }

            return this;
        };

        /**
         * 移动指定的图形(Shape)或者组(Group)的位置
         * @param {string} shapeId 形状唯一标识
         * @param {number} dx
         * @param {number} dy
         */
        Storage.prototype.drift = function (shapeId, dx, dy) {
            var shape = this._elements[shapeId];
            if (shape) {
                shape.needTransform = true;
                if (shape.draggable === 'horizontal') {
                    dy = 0;
                }
                else if (shape.draggable === 'vertical') {
                    dx = 0;
                }
                if (!shape.ondrift // ondrift
                    // 有onbrush并且调用执行返回false或undefined则继续
                    || (shape.ondrift && !shape.ondrift(dx, dy))
                ) {
                    shape.drift(dx, dy);
                }
            }

            return this;
        };

        /**
         * 添加高亮层数据
         * 
         * @param {module:zrender/shape/Base} shape
         */
        Storage.prototype.addHover = function (shape) {
            shape.updateNeedTransform();
            this._hoverElements.push(shape);
            return this;
        };

        /**
         * 清空高亮层数据
         */
        Storage.prototype.delHover = function () {
            this._hoverElements = [];
            return this;
        };

        /**
         * 是否有图形在高亮层里
         * @return {boolean}
         */
        Storage.prototype.hasHoverShape = function () {
            return this._hoverElements.length > 0;
        };

        /**
         * 添加图形(Shape)或者组(Group)到根节点
         * @param {module:zrender/shape/Shape|module:zrender/Group} el
         */
        Storage.prototype.addRoot = function (el) {
            // Element has been added
            if (this._elements[el.id]) {
                return;
            }

            if (el instanceof Group) {
                el.addChildrenToStorage(this);
            }

            this.addToMap(el);
            this._roots.push(el);
        };

        /**
         * 删除指定的图形(Shape)或者组(Group)
         * @param {string|Array.<string>} [elId] 如果为空清空整个Storage
         */
        Storage.prototype.delRoot = function (elId) {
            if (typeof(elId) == 'undefined') {
                // 不指定elId清空
                for (var i = 0; i < this._roots.length; i++) {
                    var root = this._roots[i];
                    if (root instanceof Group) {
                        root.delChildrenFromStorage(this);
                    }
                }

                this._elements = {};
                this._hoverElements = [];
                this._roots = [];
                this._shapeList = [];
                this._shapeListOffset = 0;

                return;
            }

            if (elId instanceof Array) {
                for (var i = 0, l = elId.length; i < l; i++) {
                    this.delRoot(elId[i]);
                }
                return;
            }

            var el;
            if (typeof(elId) == 'string') {
                el = this._elements[elId];
            }
            else {
                el = elId;
            }

            var idx = util.indexOf(this._roots, el);
            if (idx >= 0) {
                this.delFromMap(el.id);
                this._roots.splice(idx, 1);
                if (el instanceof Group) {
                    el.delChildrenFromStorage(this);
                }
            }
        };

        Storage.prototype.addToMap = function (el) {
            if (el instanceof Group) {
                el._storage = this;
            }
            el.modSelf();

            this._elements[el.id] = el;

            return this;
        };

        Storage.prototype.get = function (elId) {
            return this._elements[elId];
        };

        Storage.prototype.delFromMap = function (elId) {
            var el = this._elements[elId];
            if (el) {
                delete this._elements[elId];

                if (el instanceof Group) {
                    el._storage = null;
                }
            }

            return this;
        };

        /**
         * 清空并且释放Storage
         */
        Storage.prototype.dispose = function () {
            this._elements = 
            this._renderList = 
            this._roots =
            this._hoverElements = null;
        };

        return Storage;
    });
define('zrender/Painter', ['require', './config', './tool/util', './tool/log', './loadingEffect/Base', './Layer', './shape/Image'], function (require) {
        'use strict';

        var config = require('./config');
        var util = require('./tool/util');
        // var vec2 = require('./tool/vector');
        var log = require('./tool/log');
        // var matrix = require('./tool/matrix');
        var BaseLoadingEffect = require('./loadingEffect/Base');

        var Layer = require('./Layer');

        // 返回false的方法，用于避免页面被选中
        function returnFalse() {
            return false;
        }

        // 什么都不干的空方法
        function doNothing() {}

        function isLayerValid(layer) {
            if (!layer) {
                return false;
            }
            
            if (layer.isBuildin) {
                return true;
            }

            if (typeof(layer.resize) !== 'function'
                || typeof(layer.refresh) !== 'function'
            ) {
                return false;
            }

            return true;
        }

        /**
         * @alias module:zrender/Painter
         * @constructor
         * @param {HTMLElement} root 绘图容器
         * @param {module:zrender/Storage} storage
         */
        var Painter = function (root, storage) {
            /**
             * 绘图容器
             * @type {HTMLElement}
             */
            this.root = root;
            root.style['-webkit-tap-highlight-color'] = 'transparent';
            root.style['-webkit-user-select'] = 'none';
            root.style['user-select'] = 'none';
            root.style['-webkit-touch-callout'] = 'none';

            /**
             * @type {module:zrender/Storage}
             */
            this.storage = storage;

            root.innerHTML = '';
            this._width = this._getWidth(); // 宽，缓存记录
            this._height = this._getHeight(); // 高，缓存记录

            var domRoot = document.createElement('div');
            this._domRoot = domRoot;

            // domRoot.onselectstart = returnFalse; // 避免页面选中的尴尬
            domRoot.style.position = 'relative';
            domRoot.style.overflow = 'hidden';
            domRoot.style.width = this._width + 'px';
            domRoot.style.height = this._height + 'px';
            root.appendChild(domRoot);

            this._layers = {};

            this._zlevelList = [];

            this._layerConfig = {};

            this._loadingEffect = new BaseLoadingEffect({});
            this.shapeToImage = this._createShapeToImageProcessor();

            // 创建各层canvas
            // 背景
            this._bgDom = document.createElement('div');
            this._bgDom.style.cssText = [
                'position:absolute;left:0px;top:0px;width:',
                this._width, 'px;height:', this._height + 'px;', 
                '-webkit-user-select:none;user-select;none;',
                '-webkit-touch-callout:none;'
            ].join('');
            this._bgDom.setAttribute('data-zr-dom-id', 'bg');
            this._bgDom.className = config.elementClassName;

            domRoot.appendChild(this._bgDom);
            this._bgDom.onselectstart = returnFalse;

            // 高亮
            var hoverLayer = new Layer('_zrender_hover_', this);
            this._layers['hover'] = hoverLayer;
            domRoot.appendChild(hoverLayer.dom);
            hoverLayer.initContext();

            hoverLayer.dom.onselectstart = returnFalse;
            hoverLayer.dom.style['-webkit-user-select'] = 'none';
            hoverLayer.dom.style['user-select'] = 'none';
            hoverLayer.dom.style['-webkit-touch-callout'] = 'none';

            // Will be injected by zrender instance
            this.refreshNextFrame = null;
        };

        /**
         * 首次绘图，创建各种dom和context
         * 
         * @param {Function} callback 绘画结束后的回调函数
         */
        Painter.prototype.render = function (callback) {
            if (this.isLoading()) {
                this.hideLoading();
            }
            // TODO
            this.refresh(callback, true);

            return this;
        };

        /**
         * 刷新
         * @param {Function} callback 刷新结束后的回调函数
         * @param {boolean} paintAll 强制绘制所有shape
         */
        Painter.prototype.refresh = function (callback, paintAll) {
            var list = this.storage.getShapeList(true);
            this._paintList(list, paintAll);

            // Paint custum layers
            for (var i = 0; i < this._zlevelList.length; i++) {
                var z = this._zlevelList[i];
                var layer = this._layers[z];
                if (! layer.isBuildin && layer.refresh) {
                    layer.refresh();
                }
            }

            if (typeof callback == 'function') {
                callback();
            }

            return this;
        };

        Painter.prototype._preProcessLayer = function (layer) {
            layer.unusedCount++;
            layer.updateTransform();
        };

        Painter.prototype._postProcessLayer = function (layer) {
            layer.dirty = false;
            // 删除过期的层
            // PENDING
            // if (layer.unusedCount >= 500) {
            //     this.delLayer(z);
            // }
            if (layer.unusedCount == 1) {
                layer.clear();
            }
        };
 
        Painter.prototype._paintList = function (list, paintAll) {

            if (typeof(paintAll) == 'undefined') {
                paintAll = false;
            }

            this._updateLayerStatus(list);

            var currentLayer;
            var currentZLevel;
            var ctx;

            this.eachBuildinLayer(this._preProcessLayer);

            // var invTransform = [];

            for (var i = 0, l = list.length; i < l; i++) {
                var shape = list[i];

                // Change draw layer
                if (currentZLevel !== shape.zlevel) {
                    if (currentLayer) {
                        if (currentLayer.needTransform) {
                            ctx.restore();
                        }
                        ctx.flush && ctx.flush();
                    }

                    currentZLevel = shape.zlevel;
                    currentLayer = this.getLayer(currentZLevel);

                    if (!currentLayer.isBuildin) {
                        log(
                            'ZLevel ' + currentZLevel
                            + ' has been used by unkown layer ' + currentLayer.id
                        );
                    }

                    ctx = currentLayer.ctx;

                    // Reset the count
                    currentLayer.unusedCount = 0;

                    if (currentLayer.dirty || paintAll) {
                        currentLayer.clear();
                    }

                    if (currentLayer.needTransform) {
                        ctx.save();
                        currentLayer.setTransform(ctx);
                    }
                }

                if ((currentLayer.dirty || paintAll) && !shape.invisible) {
                    if (
                        !shape.onbrush
                        || (shape.onbrush && !shape.onbrush(ctx, false))
                    ) {
                        if (config.catchBrushException) {
                            try {
                                shape.brush(ctx, false, this.refreshNextFrame);
                            }
                            catch (error) {
                                log(
                                    error,
                                    'brush error of ' + shape.type,
                                    shape
                                );
                            }
                        }
                        else {
                            shape.brush(ctx, false, this.refreshNextFrame);
                        }
                    }
                }

                shape.__dirty = false;
            }

            if (currentLayer) {
                if (currentLayer.needTransform) {
                    ctx.restore();
                }
                ctx.flush && ctx.flush();
            }

            this.eachBuildinLayer(this._postProcessLayer);
        };

        /**
         * 获取 zlevel 所在层，如果不存在则会创建一个新的层
         * @param {number} zlevel
         * @return {module:zrender/Layer}
         */
        Painter.prototype.getLayer = function (zlevel) {
            var layer = this._layers[zlevel];
            if (!layer) {
                // Create a new layer
                layer = new Layer(zlevel, this);
                layer.isBuildin = true;

                if (this._layerConfig[zlevel]) {
                    util.merge(layer, this._layerConfig[zlevel], true);
                }

                layer.updateTransform();

                this.insertLayer(zlevel, layer);

                // Context is created after dom inserted to document
                // Or excanvas will get 0px clientWidth and clientHeight
                layer.initContext();
            }

            return layer;
        };

        Painter.prototype.insertLayer = function (zlevel, layer) {
            if (this._layers[zlevel]) {
                log('ZLevel ' + zlevel + ' has been used already');
                return;
            }
            // Check if is a valid layer
            if (!isLayerValid(layer)) {
                log('Layer of zlevel ' + zlevel + ' is not valid');
                return;
            }

            var len = this._zlevelList.length;
            var prevLayer = null;
            var i = -1;
            if (len > 0 && zlevel > this._zlevelList[0]) {
                for (i = 0; i < len - 1; i++) {
                    if (
                        this._zlevelList[i] < zlevel
                        && this._zlevelList[i + 1] > zlevel
                    ) {
                        break;
                    }
                }
                prevLayer = this._layers[this._zlevelList[i]];
            }
            this._zlevelList.splice(i + 1, 0, zlevel);

            var prevDom = prevLayer ? prevLayer.dom : this._bgDom;
            if (prevDom.nextSibling) {
                prevDom.parentNode.insertBefore(
                    layer.dom,
                    prevDom.nextSibling
                );
            }
            else {
                prevDom.parentNode.appendChild(layer.dom);
            }

            this._layers[zlevel] = layer;
        };

        // Iterate each layer
        Painter.prototype.eachLayer = function (cb, context) {
            for (var i = 0; i < this._zlevelList.length; i++) {
                var z = this._zlevelList[i];
                cb.call(context, this._layers[z], z);
            }
        };

        // Iterate each buildin layer
        Painter.prototype.eachBuildinLayer = function (cb, context) {
            for (var i = 0; i < this._zlevelList.length; i++) {
                var z = this._zlevelList[i];
                var layer = this._layers[z];
                if (layer.isBuildin) {
                    cb.call(context, layer, z);
                }
            }
        };

        // Iterate each other layer except buildin layer
        Painter.prototype.eachOtherLayer = function (cb, context) {
            for (var i = 0; i < this._zlevelList.length; i++) {
                var z = this._zlevelList[i];
                var layer = this._layers[z];
                if (! layer.isBuildin) {
                    cb.call(context, layer, z);
                }
            }
        };

        /**
         * 获取所有已创建的层
         * @param {Array.<module:zrender/Layer>} [prevLayer]
         */
        Painter.prototype.getLayers = function () {
            return this._layers;
        };

        Painter.prototype._updateLayerStatus = function (list) {
            
            var layers = this._layers;

            var elCounts = {};

            this.eachBuildinLayer(function (layer, z) {
                elCounts[z] = layer.elCount;
                layer.elCount = 0;
            });

            for (var i = 0, l = list.length; i < l; i++) {
                var shape = list[i];
                var zlevel = shape.zlevel;
                var layer = layers[zlevel];
                if (layer) {
                    layer.elCount++;
                    // 已经被标记为需要刷新
                    if (layer.dirty) {
                        continue;
                    }
                    layer.dirty = shape.__dirty;
                }
            }

            // 层中的元素数量有发生变化
            this.eachBuildinLayer(function (layer, z) {
                if (elCounts[z] !== layer.elCount) {
                    layer.dirty = true;
                }
            });
        };

        /**
         * 指定的图形列表
         * @param {Array.<module:zrender/shape/Base>} shapeList 需要更新的图形元素列表
         * @param {Function} [callback] 视图更新后回调函数
         */
        Painter.prototype.refreshShapes = function (shapeList, callback) {
            for (var i = 0, l = shapeList.length; i < l; i++) {
                var shape = shapeList[i];
                shape.modSelf();
            }

            this.refresh(callback);
            return this;
        };

        /**
         * 设置loading特效
         * 
         * @param {Object} loadingEffect loading特效
         * @return {Painter}
         */
        Painter.prototype.setLoadingEffect = function (loadingEffect) {
            this._loadingEffect = loadingEffect;
            return this;
        };

        /**
         * 清除hover层外所有内容
         */
        Painter.prototype.clear = function () {
            this.eachBuildinLayer(this._clearLayer);
            return this;
        };

        Painter.prototype._clearLayer = function (layer) {
            layer.clear();
        };

        /**
         * 修改指定zlevel的绘制参数
         * 
         * @param {string} zlevel
         * @param {Object} config 配置对象
         * @param {string} [config.clearColor=0] 每次清空画布的颜色
         * @param {string} [config.motionBlur=false] 是否开启动态模糊
         * @param {number} [config.lastFrameAlpha=0.7]
         *                 在开启动态模糊的时候使用，与上一帧混合的alpha值，值越大尾迹越明显
         * @param {Array.<number>} [position] 层的平移
         * @param {Array.<number>} [rotation] 层的旋转
         * @param {Array.<number>} [scale] 层的缩放
         * @param {boolean} [zoomable=false] 层是否支持鼠标缩放操作
         * @param {boolean} [panable=false] 层是否支持鼠标平移操作
         */
        Painter.prototype.modLayer = function (zlevel, config) {
            if (config) {
                if (!this._layerConfig[zlevel]) {
                    this._layerConfig[zlevel] = config;
                }
                else {
                    util.merge(this._layerConfig[zlevel], config, true);
                }

                var layer = this._layers[zlevel];

                if (layer) {
                    util.merge(layer, this._layerConfig[zlevel], true);
                }
            }
        };

        /**
         * 删除指定层
         * @param {number} zlevel 层所在的zlevel
         */
        Painter.prototype.delLayer = function (zlevel) {
            var layer = this._layers[zlevel];
            if (!layer) {
                return;
            }
            // Save config
            this.modLayer(zlevel, {
                position: layer.position,
                rotation: layer.rotation,
                scale: layer.scale
            });
            layer.dom.parentNode.removeChild(layer.dom);
            delete this._layers[zlevel];

            this._zlevelList.splice(util.indexOf(this._zlevelList, zlevel), 1);
        };

        /**
         * 刷新hover层
         */
        Painter.prototype.refreshHover = function () {
            this.clearHover();
            var list = this.storage.getHoverShapes(true);
            for (var i = 0, l = list.length; i < l; i++) {
                this._brushHover(list[i]);
            }
            var ctx = this._layers.hover.ctx;
            ctx.flush && ctx.flush();

            this.storage.delHover();

            return this;
        };

        /**
         * 清除hover层所有内容
         */
        Painter.prototype.clearHover = function () {
            var hover = this._layers.hover;
            hover && hover.clear();

            return this;
        };

        /**
         * 显示loading
         * 
         * @param {Object=} loadingEffect loading效果对象
         */
        Painter.prototype.showLoading = function (loadingEffect) {
            this._loadingEffect && this._loadingEffect.stop();
            loadingEffect && this.setLoadingEffect(loadingEffect);
            this._loadingEffect.start(this);
            this.loading = true;

            return this;
        };

        /**
         * loading结束
         */
        Painter.prototype.hideLoading = function () {
            this._loadingEffect.stop();

            this.clearHover();
            this.loading = false;
            return this;
        };

        /**
         * loading结束判断
         */
        Painter.prototype.isLoading = function () {
            return this.loading;
        };

        /**
         * 区域大小变化后重绘
         */
        Painter.prototype.resize = function () {
            var domRoot = this._domRoot;
            domRoot.style.display = 'none';

            var width = this._getWidth();
            var height = this._getHeight();

            domRoot.style.display = '';

            // 优化没有实际改变的resize
            if (this._width != width || height != this._height) {
                this._width = width;
                this._height = height;

                domRoot.style.width = width + 'px';
                domRoot.style.height = height + 'px';

                for (var id in this._layers) {

                    this._layers[id].resize(width, height);
                }

                this.refresh(null, true);
            }

            return this;
        };

        /**
         * 清除单独的一个层
         * @param {number} zLevel
         */
        Painter.prototype.clearLayer = function (zLevel) {
            var layer = this._layers[zLevel];
            if (layer) {
                layer.clear();
            }
        };

        /**
         * 释放
         */
        Painter.prototype.dispose = function () {
            if (this.isLoading()) {
                this.hideLoading();
            }

            this.root.innerHTML = '';

            this.root =
            this.storage =

            this._domRoot = 
            this._layers = null;
        };

        Painter.prototype.getDomHover = function () {
            return this._layers.hover.dom;
        };

        /**
         * 图像导出
         * @param {string} type
         * @param {string} [backgroundColor='#fff'] 背景色
         * @return {string} 图片的Base64 url
         */
        Painter.prototype.toDataURL = function (type, backgroundColor, args) {
            if (window['G_vmlCanvasManager']) {
                return null;
            }

            var imageLayer = new Layer('image', this);
            this._bgDom.appendChild(imageLayer.dom);
            imageLayer.initContext();
            
            var ctx = imageLayer.ctx;
            imageLayer.clearColor = backgroundColor || '#fff';
            imageLayer.clear();
            
            var self = this;
            // 升序遍历，shape上的zlevel指定绘画图层的z轴层叠

            this.storage.iterShape(
                function (shape) {
                    if (!shape.invisible) {
                        if (!shape.onbrush // 没有onbrush
                            // 有onbrush并且调用执行返回false或undefined则继续粉刷
                            || (shape.onbrush && !shape.onbrush(ctx, false))
                        ) {
                            if (config.catchBrushException) {
                                try {
                                    shape.brush(ctx, false, self.refreshNextFrame);
                                }
                                catch (error) {
                                    log(
                                        error,
                                        'brush error of ' + shape.type,
                                        shape
                                    );
                                }
                            }
                            else {
                                shape.brush(ctx, false, self.refreshNextFrame);
                            }
                        }
                    }
                },
                { normal: 'up', update: true }
            );
            var image = imageLayer.dom.toDataURL(type, args); 
            ctx = null;
            this._bgDom.removeChild(imageLayer.dom);
            return image;
        };

        /**
         * 获取绘图区域宽度
         */
        Painter.prototype.getWidth = function () {
            return this._width;
        };

        /**
         * 获取绘图区域高度
         */
        Painter.prototype.getHeight = function () {
            return this._height;
        };

        Painter.prototype._getWidth = function () {
            var root = this.root;
            var stl = root.currentStyle
                      || document.defaultView.getComputedStyle(root);

            return ((root.clientWidth || parseInt(stl.width, 10))
                    - parseInt(stl.paddingLeft, 10) // 请原谅我这比较粗暴
                    - parseInt(stl.paddingRight, 10)).toFixed(0) - 0;
        };

        Painter.prototype._getHeight = function () {
            var root = this.root;
            var stl = root.currentStyle
                      || document.defaultView.getComputedStyle(root);

            return ((root.clientHeight || parseInt(stl.height, 10))
                    - parseInt(stl.paddingTop, 10) // 请原谅我这比较粗暴
                    - parseInt(stl.paddingBottom, 10)).toFixed(0) - 0;
        };

        Painter.prototype._brushHover = function (shape) {
            var ctx = this._layers.hover.ctx;

            if (!shape.onbrush // 没有onbrush
                // 有onbrush并且调用执行返回false或undefined则继续粉刷
                || (shape.onbrush && !shape.onbrush(ctx, true))
            ) {
                var layer = this.getLayer(shape.zlevel);
                if (layer.needTransform) {
                    ctx.save();
                    layer.setTransform(ctx);
                }
                // Retina 优化
                if (config.catchBrushException) {
                    try {
                        shape.brush(ctx, true, this.refreshNextFrame);
                    }
                    catch (error) {
                        log(
                            error, 'hoverBrush error of ' + shape.type, shape
                        );
                    }
                }
                else {
                    shape.brush(ctx, true, this.refreshNextFrame);
                }
                if (layer.needTransform) {
                    ctx.restore();
                }
            }
        };

        Painter.prototype._shapeToImage = function (
            id, shape, width, height, devicePixelRatio
        ) {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            canvas.setAttribute('width', width * devicePixelRatio);
            canvas.setAttribute('height', height * devicePixelRatio);

            ctx.clearRect(0, 0, width * devicePixelRatio, height * devicePixelRatio);

            var shapeTransform = {
                position : shape.position,
                rotation : shape.rotation,
                scale : shape.scale
            };
            shape.position = [ 0, 0, 0 ];
            shape.rotation = 0;
            shape.scale = [ 1, 1 ];
            if (shape) {
                shape.brush(ctx, false);
            }

            var ImageShape = require('./shape/Image');
            var imgShape = new ImageShape({
                id : id,
                style : {
                    x : 0,
                    y : 0,
                    image : canvas
                }
            });

            if (shapeTransform.position != null) {
                imgShape.position = shape.position = shapeTransform.position;
            }

            if (shapeTransform.rotation != null) {
                imgShape.rotation = shape.rotation = shapeTransform.rotation;
            }

            if (shapeTransform.scale != null) {
                imgShape.scale = shape.scale = shapeTransform.scale;
            }

            return imgShape;
        };

        Painter.prototype._createShapeToImageProcessor = function () {
            if (window['G_vmlCanvasManager']) {
                return doNothing;
            }

            var me = this;

            return function (id, e, width, height) {
                return me._shapeToImage(
                    id, e, width, height, config.devicePixelRatio
                );
            };
        };

        return Painter;
    });
define('zrender/animation/Animation', ['require', './Clip', '../tool/color', '../tool/util', '../tool/event'], function (require) {
        
        'use strict';

        var Clip = require('./Clip');
        var color = require('../tool/color');
        var util = require('../tool/util');
        var Dispatcher = require('../tool/event').Dispatcher;

        var requestAnimationFrame = window.requestAnimationFrame
                                    || window.msRequestAnimationFrame
                                    || window.mozRequestAnimationFrame
                                    || window.webkitRequestAnimationFrame
                                    || function (func) {
                                        setTimeout(func, 16);
                                    };

        var arraySlice = Array.prototype.slice;

        /**
         * @typedef {Object} IZRenderStage
         * @property {Function} update
         */
        
        /** 
         * @alias module:zrender/animation/Animation
         * @constructor
         * @param {Object} [options]
         * @param {Function} [options.onframe]
         * @param {IZRenderStage} [options.stage]
         * @example
         *     var animation = new Animation();
         *     var obj = {
         *         x: 100,
         *         y: 100
         *     };
         *     animation.animate(node.position)
         *         .when(1000, {
         *             x: 500,
         *             y: 500
         *         })
         *         .when(2000, {
         *             x: 100,
         *             y: 100
         *         })
         *         .start('spline');
         */
        var Animation = function (options) {

            options = options || {};

            this.stage = options.stage || {};

            this.onframe = options.onframe || function() {};

            // private properties
            this._clips = [];

            this._running = false;

            this._time = 0;

            Dispatcher.call(this);
        };

        Animation.prototype = {
            /**
             * 添加动画片段
             * @param {module:zrender/animation/Clip} clip
             */
            add: function(clip) {
                this._clips.push(clip);
            },
            /**
             * 删除动画片段
             * @param {module:zrender/animation/Clip} clip
             */
            remove: function(clip) {
                var idx = util.indexOf(this._clips, clip);
                if (idx >= 0) {
                    this._clips.splice(idx, 1);
                }
            },
            _update: function() {

                var time = new Date().getTime();
                var delta = time - this._time;
                var clips = this._clips;
                var len = clips.length;

                var deferredEvents = [];
                var deferredClips = [];
                for (var i = 0; i < len; i++) {
                    var clip = clips[i];
                    var e = clip.step(time);
                    // Throw out the events need to be called after
                    // stage.update, like destroy
                    if (e) {
                        deferredEvents.push(e);
                        deferredClips.push(clip);
                    }
                }

                // Remove the finished clip
                for (var i = 0; i < len;) {
                    if (clips[i]._needsRemove) {
                        clips[i] = clips[len - 1];
                        clips.pop();
                        len--;
                    }
                    else {
                        i++;
                    }
                }

                len = deferredEvents.length;
                for (var i = 0; i < len; i++) {
                    deferredClips[i].fire(deferredEvents[i]);
                }

                this._time = time;

                this.onframe(delta);

                this.dispatch('frame', delta);

                if (this.stage.update) {
                    this.stage.update();
                }
            },
            /**
             * 开始运行动画
             */
            start: function () {
                var self = this;

                this._running = true;

                function step() {
                    if (self._running) {
                        
                        requestAnimationFrame(step);

                        self._update();
                    }
                }

                this._time = new Date().getTime();
                requestAnimationFrame(step);
            },
            /**
             * 停止运行动画
             */
            stop: function () {
                this._running = false;
            },
            /**
             * 清除所有动画片段
             */
            clear : function () {
                this._clips = [];
            },
            /**
             * 对一个目标创建一个animator对象，可以指定目标中的属性使用动画
             * @param  {Object} target
             * @param  {Object} options
             * @param  {boolean} [options.loop=false] 是否循环播放动画
             * @param  {Function} [options.getter=null]
             *         如果指定getter函数，会通过getter函数取属性值
             * @param  {Function} [options.setter=null]
             *         如果指定setter函数，会通过setter函数设置属性值
             * @return {module:zrender/animation/Animation~Animator}
             */
            animate : function (target, options) {
                options = options || {};
                var deferred = new Animator(
                    target,
                    options.loop,
                    options.getter, 
                    options.setter
                );
                deferred.animation = this;
                return deferred;
            },
            constructor: Animation
        };

        util.merge(Animation.prototype, Dispatcher.prototype, true);

        function _defaultGetter(target, key) {
            return target[key];
        }

        function _defaultSetter(target, key, value) {
            target[key] = value;
        }

        function _interpolateNumber(p0, p1, percent) {
            return (p1 - p0) * percent + p0;
        }

        function _interpolateArray(p0, p1, percent, out, arrDim) {
            var len = p0.length;
            if (arrDim == 1) {
                for (var i = 0; i < len; i++) {
                    out[i] = _interpolateNumber(p0[i], p1[i], percent); 
                }
            }
            else {
                var len2 = p0[0].length;
                for (var i = 0; i < len; i++) {
                    for (var j = 0; j < len2; j++) {
                        out[i][j] = _interpolateNumber(
                            p0[i][j], p1[i][j], percent
                        );
                    }
                }
            }
        }

        function _isArrayLike(data) {
            switch (typeof data) {
                case 'undefined':
                case 'string':
                    return false;
            }
            
            return typeof data.length !== 'undefined';
        }

        function _catmullRomInterpolateArray(
            p0, p1, p2, p3, t, t2, t3, out, arrDim
        ) {
            var len = p0.length;
            if (arrDim == 1) {
                for (var i = 0; i < len; i++) {
                    out[i] = _catmullRomInterpolate(
                        p0[i], p1[i], p2[i], p3[i], t, t2, t3
                    );
                }
            }
            else {
                var len2 = p0[0].length;
                for (var i = 0; i < len; i++) {
                    for (var j = 0; j < len2; j++) {
                        out[i][j] = _catmullRomInterpolate(
                            p0[i][j], p1[i][j], p2[i][j], p3[i][j],
                            t, t2, t3
                        );
                    }
                }
            }
        }

        function _catmullRomInterpolate(p0, p1, p2, p3, t, t2, t3) {
            var v0 = (p2 - p0) * 0.5;
            var v1 = (p3 - p1) * 0.5;
            return (2 * (p1 - p2) + v0 + v1) * t3 
                    + (-3 * (p1 - p2) - 2 * v0 - v1) * t2
                    + v0 * t + p1;
        }

        function _cloneValue(value) {
            if (_isArrayLike(value)) {
                var len = value.length;
                if (_isArrayLike(value[0])) {
                    var ret = [];
                    for (var i = 0; i < len; i++) {
                        ret.push(arraySlice.call(value[i]));
                    }
                    return ret;
                }
                else {
                    return arraySlice.call(value);
                }
            }
            else {
                return value;
            }
        }

        function rgba2String(rgba) {
            rgba[0] = Math.floor(rgba[0]);
            rgba[1] = Math.floor(rgba[1]);
            rgba[2] = Math.floor(rgba[2]);

            return 'rgba(' + rgba.join(',') + ')';
        }

        /**
         * @alias module:zrender/animation/Animation~Animator
         * @constructor
         * @param {Object} target
         * @param {boolean} loop
         * @param {Function} getter
         * @param {Function} setter
         */
        var Animator = function(target, loop, getter, setter) {
            this._tracks = {};
            this._target = target;

            this._loop = loop || false;

            this._getter = getter || _defaultGetter;
            this._setter = setter || _defaultSetter;

            this._clipCount = 0;

            this._delay = 0;

            this._doneList = [];

            this._onframeList = [];

            this._clipList = [];
        };

        Animator.prototype = {
            /**
             * 设置动画关键帧
             * @param  {number} time 关键帧时间，单位是ms
             * @param  {Object} props 关键帧的属性值，key-value表示
             * @return {module:zrender/animation/Animation~Animator}
             */
            when : function(time /* ms */, props) {
                for (var propName in props) {
                    if (!this._tracks[propName]) {
                        this._tracks[propName] = [];
                        // If time is 0 
                        //  Then props is given initialize value
                        // Else
                        //  Initialize value from current prop value
                        if (time !== 0) {
                            this._tracks[propName].push({
                                time : 0,
                                value : _cloneValue(
                                    this._getter(this._target, propName)
                                )
                            });
                        }
                    }
                    this._tracks[propName].push({
                        time : parseInt(time, 10),
                        value : props[propName]
                    });
                }
                return this;
            },
            /**
             * 添加动画每一帧的回调函数
             * @param  {Function} callback
             * @return {module:zrender/animation/Animation~Animator}
             */
            during: function (callback) {
                this._onframeList.push(callback);
                return this;
            },
            /**
             * 开始执行动画
             * @param  {string|Function} easing 
             *         动画缓动函数，详见{@link module:zrender/animation/easing}
             * @return {module:zrender/animation/Animation~Animator}
             */
            start: function (easing) {

                var self = this;
                var setter = this._setter;
                var getter = this._getter;
                var useSpline = easing === 'spline';

                var ondestroy = function() {
                    self._clipCount--;
                    if (self._clipCount === 0) {
                        // Clear all tracks
                        self._tracks = {};

                        var len = self._doneList.length;
                        for (var i = 0; i < len; i++) {
                            self._doneList[i].call(self);
                        }
                    }
                };

                var createTrackClip = function (keyframes, propName) {
                    var trackLen = keyframes.length;
                    if (!trackLen) {
                        return;
                    }
                    // Guess data type
                    var firstVal = keyframes[0].value;
                    var isValueArray = _isArrayLike(firstVal);
                    var isValueColor = false;

                    // For vertices morphing
                    var arrDim = (
                            isValueArray 
                            && _isArrayLike(firstVal[0])
                        )
                        ? 2 : 1;
                    // Sort keyframe as ascending
                    keyframes.sort(function(a, b) {
                        return a.time - b.time;
                    });
                    var trackMaxTime;
                    if (trackLen) {
                        trackMaxTime = keyframes[trackLen - 1].time;
                    }
                    else {
                        return;
                    }
                    // Percents of each keyframe
                    var kfPercents = [];
                    // Value of each keyframe
                    var kfValues = [];
                    for (var i = 0; i < trackLen; i++) {
                        kfPercents.push(keyframes[i].time / trackMaxTime);
                        // Assume value is a color when it is a string
                        var value = keyframes[i].value;
                        if (typeof(value) == 'string') {
                            value = color.toArray(value);
                            if (value.length === 0) {    // Invalid color
                                value[0] = value[1] = value[2] = 0;
                                value[3] = 1;
                            }
                            isValueColor = true;
                        }
                        kfValues.push(value);
                    }

                    // Cache the key of last frame to speed up when 
                    // animation playback is sequency
                    var cacheKey = 0;
                    var cachePercent = 0;
                    var start;
                    var i;
                    var w;
                    var p0;
                    var p1;
                    var p2;
                    var p3;


                    if (isValueColor) {
                        var rgba = [ 0, 0, 0, 0 ];
                    }

                    var onframe = function (target, percent) {
                        // Find the range keyframes
                        // kf1-----kf2---------current--------kf3
                        // find kf2 and kf3 and do interpolation
                        if (percent < cachePercent) {
                            // Start from next key
                            start = Math.min(cacheKey + 1, trackLen - 1);
                            for (i = start; i >= 0; i--) {
                                if (kfPercents[i] <= percent) {
                                    break;
                                }
                            }
                            i = Math.min(i, trackLen - 2);
                        }
                        else {
                            for (i = cacheKey; i < trackLen; i++) {
                                if (kfPercents[i] > percent) {
                                    break;
                                }
                            }
                            i = Math.min(i - 1, trackLen - 2);
                        }
                        cacheKey = i;
                        cachePercent = percent;

                        var range = (kfPercents[i + 1] - kfPercents[i]);
                        if (range === 0) {
                            return;
                        }
                        else {
                            w = (percent - kfPercents[i]) / range;
                        }
                        if (useSpline) {
                            p1 = kfValues[i];
                            p0 = kfValues[i === 0 ? i : i - 1];
                            p2 = kfValues[i > trackLen - 2 ? trackLen - 1 : i + 1];
                            p3 = kfValues[i > trackLen - 3 ? trackLen - 1 : i + 2];
                            if (isValueArray) {
                                _catmullRomInterpolateArray(
                                    p0, p1, p2, p3, w, w * w, w * w * w,
                                    getter(target, propName),
                                    arrDim
                                );
                            }
                            else {
                                var value;
                                if (isValueColor) {
                                    value = _catmullRomInterpolateArray(
                                        p0, p1, p2, p3, w, w * w, w * w * w,
                                        rgba, 1
                                    );
                                    value = rgba2String(rgba);
                                }
                                else {
                                    value = _catmullRomInterpolate(
                                        p0, p1, p2, p3, w, w * w, w * w * w
                                    );
                                }
                                setter(
                                    target,
                                    propName,
                                    value
                                );
                            }
                        }
                        else {
                            if (isValueArray) {
                                _interpolateArray(
                                    kfValues[i], kfValues[i + 1], w,
                                    getter(target, propName),
                                    arrDim
                                );
                            }
                            else {
                                var value;
                                if (isValueColor) {
                                    _interpolateArray(
                                        kfValues[i], kfValues[i + 1], w,
                                        rgba, 1
                                    );
                                    value = rgba2String(rgba);
                                }
                                else {
                                    value = _interpolateNumber(kfValues[i], kfValues[i + 1], w);
                                }
                                setter(
                                    target,
                                    propName,
                                    value
                                );
                            }
                        }

                        for (i = 0; i < self._onframeList.length; i++) {
                            self._onframeList[i](target, percent);
                        }
                    };

                    var clip = new Clip({
                        target : self._target,
                        life : trackMaxTime,
                        loop : self._loop,
                        delay : self._delay,
                        onframe : onframe,
                        ondestroy : ondestroy
                    });

                    if (easing && easing !== 'spline') {
                        clip.easing = easing;
                    }
                    self._clipList.push(clip);
                    self._clipCount++;
                    self.animation.add(clip);
                };

                for (var propName in this._tracks) {
                    createTrackClip(this._tracks[propName], propName);
                }
                return this;
            },
            /**
             * 停止动画
             */
            stop : function() {
                for (var i = 0; i < this._clipList.length; i++) {
                    var clip = this._clipList[i];
                    this.animation.remove(clip);
                }
                this._clipList = [];
            },
            /**
             * 设置动画延迟开始的时间
             * @param  {number} time 单位ms
             * @return {module:zrender/animation/Animation~Animator}
             */
            delay : function (time) {
                this._delay = time;
                return this;
            },
            /**
             * 添加动画结束的回调
             * @param  {Function} cb
             * @return {module:zrender/animation/Animation~Animator}
             */
            done : function(cb) {
                if (cb) {
                    this._doneList.push(cb);
                }
                return this;
            }
        };

        return Animation;
    });
define('zrender/tool/guid', [], function () {
        var idStart = 0x0907;

        return function () {
            return 'zrender__' + (idStart++);
        };
    });
define('zrender/Handler', ['require', './config', './tool/env', './tool/event', './tool/util', './tool/vector', './tool/matrix', './mixin/Eventful'], function (require) {

        'use strict';

        var config = require('./config');
        var env = require('./tool/env');
        var eventTool = require('./tool/event');
        var util = require('./tool/util');
        var vec2 = require('./tool/vector');
        var mat2d = require('./tool/matrix');
        var EVENT = config.EVENT;

        var Eventful = require('./mixin/Eventful');

        var domHandlerNames = [
            'resize', 'click', 'dblclick',
            'mousewheel', 'mousemove', 'mouseout', 'mouseup', 'mousedown',
            'touchstart', 'touchend', 'touchmove'
        ];

        var isZRenderElement = function (event) {
            // 暂时忽略 IE8-
            if (window.G_vmlCanvasManager) {
                return true;
            }

            event = event || window.event;
            // 进入对象优先~
            var target = event.toElement
                          || event.relatedTarget
                          || event.srcElement
                          || event.target;

            return target && target.className.match(config.elementClassName)
        };

        var domHandlers = {
            /**
             * 窗口大小改变响应函数
             * @inner
             * @param {Event} event
             */
            resize: function (event) {
                event = event || window.event;
                this._lastHover = null;
                this._isMouseDown = 0;
                
                // 分发config.EVENT.RESIZE事件，global
                this.dispatch(EVENT.RESIZE, event);
            },

            /**
             * 点击响应函数
             * @inner
             * @param {Event} event
             */
            click: function (event) {
                if (! isZRenderElement(event)) {
                    return;
                }

                event = this._zrenderEventFixed(event);

                // 分发config.EVENT.CLICK事件
                var _lastHover = this._lastHover;
                if ((_lastHover && _lastHover.clickable)
                    || !_lastHover
                ) {

                    // 判断没有发生拖拽才触发click事件
                    if (this._clickThreshold < 5) {
                        this._dispatchAgency(_lastHover, EVENT.CLICK, event);
                    }
                }

                this._mousemoveHandler(event);
            },
            
            /**
             * 双击响应函数
             * @inner
             * @param {Event} event
             */
            dblclick: function (event) {
                if (! isZRenderElement(event)) {
                    return;
                }

                event = event || window.event;
                event = this._zrenderEventFixed(event);

                // 分发config.EVENT.DBLCLICK事件
                var _lastHover = this._lastHover;
                if ((_lastHover && _lastHover.clickable)
                    || !_lastHover
                ) {

                    // 判断没有发生拖拽才触发dblclick事件
                    if (this._clickThreshold < 5) {
                        this._dispatchAgency(_lastHover, EVENT.DBLCLICK, event);
                    }
                }

                this._mousemoveHandler(event);
            },
            

            /**
             * 鼠标滚轮响应函数
             * @inner
             * @param {Event} event
             */
            mousewheel: function (event) {
                if (! isZRenderElement(event)) {
                    return;
                }

                event = this._zrenderEventFixed(event);

                // http://www.sitepoint.com/html5-javascript-mouse-wheel/
                // https://developer.mozilla.org/en-US/docs/DOM/DOM_event_reference/mousewheel
                var delta = event.wheelDelta // Webkit
                            || -event.detail; // Firefox
                var scale = delta > 0 ? 1.1 : 1 / 1.1;

                var needsRefresh = false;

                var mouseX = this._mouseX;
                var mouseY = this._mouseY;
                this.painter.eachBuildinLayer(function (layer) {
                    var pos = layer.position;
                    if (layer.zoomable) {
                        layer.__zoom = layer.__zoom || 1;
                        var newZoom = layer.__zoom;
                        newZoom *= scale;
                        newZoom = Math.max(
                            Math.min(layer.maxZoom, newZoom),
                            layer.minZoom
                        );
                        scale = newZoom / layer.__zoom;
                        layer.__zoom = newZoom;
                        // Keep the mouse center when scaling
                        pos[0] -= (mouseX - pos[0]) * (scale - 1);
                        pos[1] -= (mouseY - pos[1]) * (scale - 1);
                        layer.scale[0] *= scale;
                        layer.scale[1] *= scale;
                        layer.dirty = true;
                        needsRefresh = true;

                        // Prevent browser default scroll action 
                        eventTool.stop(event);
                    }
                });
                if (needsRefresh) {
                    this.painter.refresh();
                }

                // 分发config.EVENT.MOUSEWHEEL事件
                this._dispatchAgency(this._lastHover, EVENT.MOUSEWHEEL, event);
                this._mousemoveHandler(event);
            },

            /**
             * 鼠标（手指）移动响应函数
             * @inner
             * @param {Event} event
             */
            mousemove: function (event) {
                if (! isZRenderElement(event)) {
                    return;
                }

                if (this.painter.isLoading()) {
                    return;
                }

                event = this._zrenderEventFixed(event);
                this._lastX = this._mouseX;
                this._lastY = this._mouseY;
                this._mouseX = eventTool.getX(event);
                this._mouseY = eventTool.getY(event);
                var dx = this._mouseX - this._lastX;
                var dy = this._mouseY - this._lastY;

                // 可能出现config.EVENT.DRAGSTART事件
                // 避免手抖点击误认为拖拽
                // if (this._mouseX - this._lastX > 1 || this._mouseY - this._lastY > 1) {
                this._processDragStart(event);
                // }
                this._hasfound = 0;
                this._event = event;

                this._iterateAndFindHover();

                // 找到的在迭代函数里做了处理，没找到得在迭代完后处理
                if (!this._hasfound) {
                    // 过滤首次拖拽产生的mouseout和dragLeave
                    if (!this._draggingTarget
                        || (this._lastHover && this._lastHover != this._draggingTarget)
                    ) {
                        // 可能出现config.EVENT.MOUSEOUT事件
                        this._processOutShape(event);

                        // 可能出现config.EVENT.DRAGLEAVE事件
                        this._processDragLeave(event);
                    }

                    this._lastHover = null;
                    this.storage.delHover();
                    this.painter.clearHover();
                }

                // set cursor for root element
                var cursor = 'default';

                // 如果存在拖拽中元素，被拖拽的图形元素最后addHover
                if (this._draggingTarget) {
                    this.storage.drift(this._draggingTarget.id, dx, dy);
                    this._draggingTarget.modSelf();
                    this.storage.addHover(this._draggingTarget);

                    // 拖拽不触发click事件
                    this._clickThreshold++;
                }
                else if (this._isMouseDown) {
                    var needsRefresh = false;
                    // Layer dragging
                    this.painter.eachBuildinLayer(function (layer) {
                        if (layer.panable) {
                            // PENDING
                            cursor = 'move';
                            // Keep the mouse center when scaling
                            layer.position[0] += dx;
                            layer.position[1] += dy;
                            needsRefresh = true;
                            layer.dirty = true;
                        }
                    });
                    if (needsRefresh) {
                        this.painter.refresh();
                    }
                }

                if (this._draggingTarget || (this._hasfound && this._lastHover.draggable)) {
                    cursor = 'move';
                }
                else if (this._hasfound && this._lastHover.clickable) {
                    cursor = 'pointer';
                }
                this.root.style.cursor = cursor;

                // 分发config.EVENT.MOUSEMOVE事件
                this._dispatchAgency(this._lastHover, EVENT.MOUSEMOVE, event);

                if (this._draggingTarget || this._hasfound || this.storage.hasHoverShape()) {
                    this.painter.refreshHover();
                }
            },

            /**
             * 鼠标（手指）离开响应函数
             * @inner
             * @param {Event} event
             */
            mouseout: function (event) {
                if (! isZRenderElement(event)) {
                    return;
                }

                event = this._zrenderEventFixed(event);

                var element = event.toElement || event.relatedTarget;
                if (element != this.root) {
                    while (element && element.nodeType != 9) {
                        // 忽略包含在root中的dom引起的mouseOut
                        if (element == this.root) {
                            this._mousemoveHandler(event);
                            return;
                        }

                        element = element.parentNode;
                    }
                }

                event.zrenderX = this._lastX;
                event.zrenderY = this._lastY;
                this.root.style.cursor = 'default';
                this._isMouseDown = 0;

                this._processOutShape(event);
                this._processDrop(event);
                this._processDragEnd(event);
                if (!this.painter.isLoading()) {
                    this.painter.refreshHover();
                }
                
                this.dispatch(EVENT.GLOBALOUT, event);
            },

            /**
             * 鼠标（手指）按下响应函数
             * @inner
             * @param {Event} event
             */
            mousedown: function (event) {
                if (! isZRenderElement(event)) {
                    return;
                }

                // 重置 clickThreshold
                this._clickThreshold = 0;

                if (this._lastDownButton == 2) {
                    this._lastDownButton = event.button;
                    this._mouseDownTarget = null;
                    // 仅作为关闭右键菜单使用
                    return;
                }

                this._lastMouseDownMoment = new Date();
                event = this._zrenderEventFixed(event);
                this._isMouseDown = 1;

                // 分发config.EVENT.MOUSEDOWN事件
                this._mouseDownTarget = this._lastHover;
                this._dispatchAgency(this._lastHover, EVENT.MOUSEDOWN, event);
                this._lastDownButton = event.button;
            },

            /**
             * 鼠标（手指）抬起响应函数
             * @inner
             * @param {Event} event
             */
            mouseup: function (event) {
                if (! isZRenderElement(event)) {
                    return;
                }

                event = this._zrenderEventFixed(event);
                this.root.style.cursor = 'default';
                this._isMouseDown = 0;
                this._mouseDownTarget = null;

                // 分发config.EVENT.MOUSEUP事件
                this._dispatchAgency(this._lastHover, EVENT.MOUSEUP, event);
                this._processDrop(event);
                this._processDragEnd(event);
            },

            /**
             * Touch开始响应函数
             * @inner
             * @param {Event} event
             */
            touchstart: function (event) {
                if (! isZRenderElement(event)) {
                    return;
                }

                // eventTool.stop(event);// 阻止浏览器默认事件，重要
                event = this._zrenderEventFixed(event, true);
                this._lastTouchMoment = new Date();

                // 平板补充一次findHover
                this._mobileFindFixed(event);
                this._mousedownHandler(event);
            },

            /**
             * Touch移动响应函数
             * @inner
             * @param {Event} event
             */
            touchmove: function (event) {
                if (! isZRenderElement(event)) {
                    return;
                }

                event = this._zrenderEventFixed(event, true);
                this._mousemoveHandler(event);
                if (this._isDragging) {
                    eventTool.stop(event);// 阻止浏览器默认事件，重要
                }
            },

            /**
             * Touch结束响应函数
             * @inner
             * @param {Event} event
             */
            touchend: function (event) {
                if (! isZRenderElement(event)) {
                    return;
                }

                // eventTool.stop(event);// 阻止浏览器默认事件，重要
                event = this._zrenderEventFixed(event, true);
                this._mouseupHandler(event);
                
                var now = new Date();
                if (now - this._lastTouchMoment < EVENT.touchClickDelay) {
                    this._mobileFindFixed(event);
                    this._clickHandler(event);
                    if (now - this._lastClickMoment < EVENT.touchClickDelay / 2) {
                        this._dblclickHandler(event);
                        if (this._lastHover && this._lastHover.clickable) {
                            eventTool.stop(event);// 阻止浏览器默认事件，重要
                        }
                    }
                    this._lastClickMoment = now;
                }
                this.painter.clearHover();
            }
        };

        /**
         * bind一个参数的function
         * 
         * @inner
         * @param {Function} handler 要bind的function
         * @param {Object} context 运行时this环境
         * @return {Function}
         */
        function bind1Arg(handler, context) {
            return function (e) {
                return handler.call(context, e);
            };
        }
        /**function bind2Arg(handler, context) {
            return function (arg1, arg2) {
                return handler.call(context, arg1, arg2);
            };
        }*/

        function bind3Arg(handler, context) {
            return function (arg1, arg2, arg3) {
                return handler.call(context, arg1, arg2, arg3);
            };
        }
        /**
         * 为控制类实例初始化dom 事件处理函数
         * 
         * @inner
         * @param {module:zrender/Handler} instance 控制类实例
         */
        function initDomHandler(instance) {
            var len = domHandlerNames.length;
            while (len--) {
                var name = domHandlerNames[len];
                instance['_' + name + 'Handler'] = bind1Arg(domHandlers[name], instance);
            }
        }

        /**
         * @alias module:zrender/Handler
         * @constructor
         * @extends module:zrender/mixin/Eventful
         * @param {HTMLElement} root 绘图区域
         * @param {module:zrender/Storage} storage Storage实例
         * @param {module:zrender/Painter} painter Painter实例
         */
        var Handler = function(root, storage, painter) {
            // 添加事件分发器特性
            Eventful.call(this);

            this.root = root;
            this.storage = storage;
            this.painter = painter;

            // 各种事件标识的私有变量
            // this._hasfound = false;              //是否找到hover图形元素
            // this._lastHover = null;              //最后一个hover图形元素
            // this._mouseDownTarget = null;
            // this._draggingTarget = null;         //当前被拖拽的图形元素
            // this._isMouseDown = false;
            // this._isDragging = false;
            // this._lastMouseDownMoment;
            // this._lastTouchMoment;
            // this._lastDownButton;

            this._lastX = 
            this._lastY = 
            this._mouseX = 
            this._mouseY = 0;

            this._findHover = bind3Arg(findHover, this);
            this._domHover = painter.getDomHover();
            initDomHandler(this);

            // 初始化，事件绑定，支持的所有事件都由如下原生事件计算得来
            if (window.addEventListener) {
                window.addEventListener('resize', this._resizeHandler);
                
                if (env.os.tablet || env.os.phone) {
                    // mobile支持
                    root.addEventListener('touchstart', this._touchstartHandler);
                    root.addEventListener('touchmove', this._touchmoveHandler);
                    root.addEventListener('touchend', this._touchendHandler);
                }
                else {
                    // mobile的click/move/up/down自己模拟
                    root.addEventListener('click', this._clickHandler);
                    root.addEventListener('dblclick', this._dblclickHandler);
                    root.addEventListener('mousewheel', this._mousewheelHandler);
                    root.addEventListener('mousemove', this._mousemoveHandler);
                    root.addEventListener('mousedown', this._mousedownHandler);
                    root.addEventListener('mouseup', this._mouseupHandler);
                } 
                root.addEventListener('DOMMouseScroll', this._mousewheelHandler);
                root.addEventListener('mouseout', this._mouseoutHandler);
            }
            else {
                window.attachEvent('onresize', this._resizeHandler);

                root.attachEvent('onclick', this._clickHandler);
                //root.attachEvent('ondblclick ', this._dblclickHandler);
                root.ondblclick = this._dblclickHandler;
                root.attachEvent('onmousewheel', this._mousewheelHandler);
                root.attachEvent('onmousemove', this._mousemoveHandler);
                root.attachEvent('onmouseout', this._mouseoutHandler);
                root.attachEvent('onmousedown', this._mousedownHandler);
                root.attachEvent('onmouseup', this._mouseupHandler);
            }
        };

        /**
         * 自定义事件绑定
         * @param {string} eventName 事件名称，resize，hover，drag，etc~
         * @param {Function} handler 响应函数
         * @param {Object} [context] 响应函数
         */
        Handler.prototype.on = function (eventName, handler, context) {
            this.bind(eventName, handler, context);
            return this;
        };

        /**
         * 自定义事件解绑
         * @param {string} eventName 事件名称，resize，hover，drag，etc~
         * @param {Function} handler 响应函数
         */
        Handler.prototype.un = function (eventName, handler) {
            this.unbind(eventName, handler);
            return this;
        };

        /**
         * 事件触发
         * @param {string} eventName 事件名称，resize，hover，drag，etc~
         * @param {event=} eventArgs event dom事件对象
         */
        Handler.prototype.trigger = function (eventName, eventArgs) {
            switch (eventName) {
                case EVENT.RESIZE:
                case EVENT.CLICK:
                case EVENT.DBLCLICK:
                case EVENT.MOUSEWHEEL:
                case EVENT.MOUSEMOVE:
                case EVENT.MOUSEDOWN:
                case EVENT.MOUSEUP:
                case EVENT.MOUSEOUT:
                    this['_' + eventName + 'Handler'](eventArgs);
                    break;
            }
        };

        /**
         * 释放，解绑所有事件
         */
        Handler.prototype.dispose = function () {
            var root = this.root;

            if (window.removeEventListener) {
                window.removeEventListener('resize', this._resizeHandler);

                if (env.os.tablet || env.os.phone) {
                    // mobile支持
                    root.removeEventListener('touchstart', this._touchstartHandler);
                    root.removeEventListener('touchmove', this._touchmoveHandler);
                    root.removeEventListener('touchend', this._touchendHandler);
                }
                else {
                    // mobile的click自己模拟
                    root.removeEventListener('click', this._clickHandler);
                    root.removeEventListener('dblclick', this._dblclickHandler);
                    root.removeEventListener('mousewheel', this._mousewheelHandler);
                    root.removeEventListener('mousemove', this._mousemoveHandler);
                    root.removeEventListener('mousedown', this._mousedownHandler);
                    root.removeEventListener('mouseup', this._mouseupHandler);
                }
                root.removeEventListener('DOMMouseScroll', this._mousewheelHandler);
                root.removeEventListener('mouseout', this._mouseoutHandler);
            }
            else {
                window.detachEvent('onresize', this._resizeHandler);

                root.detachEvent('onclick', this._clickHandler);
                root.detachEvent('dblclick', this._dblclickHandler);
                root.detachEvent('onmousewheel', this._mousewheelHandler);
                root.detachEvent('onmousemove', this._mousemoveHandler);
                root.detachEvent('onmouseout', this._mouseoutHandler);
                root.detachEvent('onmousedown', this._mousedownHandler);
                root.detachEvent('onmouseup', this._mouseupHandler);
            }

            this.root =
            this._domHover =
            this.storage =
            this.painter = null;
            
            this.un();
        };

        /**
         * 拖拽开始
         * 
         * @private
         * @param {Object} event 事件对象
         */
        Handler.prototype._processDragStart = function (event) {
            var _lastHover = this._lastHover;

            if (this._isMouseDown
                && _lastHover
                && _lastHover.draggable
                && !this._draggingTarget
                && this._mouseDownTarget == _lastHover
            ) {
                // 拖拽点击生效时长阀门，某些场景需要降低拖拽敏感度
                if (_lastHover.dragEnableTime && 
                    new Date() - this._lastMouseDownMoment < _lastHover.dragEnableTime
                ) {
                    return;
                }

                var _draggingTarget = _lastHover;
                this._draggingTarget = _draggingTarget;
                this._isDragging = 1;

                _draggingTarget.invisible = true;
                this.storage.mod(_draggingTarget.id);

                // 分发config.EVENT.DRAGSTART事件
                this._dispatchAgency(
                    _draggingTarget,
                    EVENT.DRAGSTART,
                    event
                );
                this.painter.refresh();
            }
        };

        /**
         * 拖拽进入目标元素
         * 
         * @private
         * @param {Object} event 事件对象
         */
        Handler.prototype._processDragEnter = function (event) {
            if (this._draggingTarget) {
                // 分发config.EVENT.DRAGENTER事件
                this._dispatchAgency(
                    this._lastHover,
                    EVENT.DRAGENTER,
                    event,
                    this._draggingTarget
                );
            }
        };

        /**
         * 拖拽在目标元素上移动
         * 
         * @private
         * @param {Object} event 事件对象
         */
        Handler.prototype._processDragOver = function (event) {
            if (this._draggingTarget) {
                // 分发config.EVENT.DRAGOVER事件
                this._dispatchAgency(
                    this._lastHover,
                    EVENT.DRAGOVER,
                    event,
                    this._draggingTarget
                );
            }
        };

        /**
         * 拖拽离开目标元素
         * 
         * @private
         * @param {Object} event 事件对象
         */
        Handler.prototype._processDragLeave = function (event) {
            if (this._draggingTarget) {
                // 分发config.EVENT.DRAGLEAVE事件
                this._dispatchAgency(
                    this._lastHover,
                    EVENT.DRAGLEAVE,
                    event,
                    this._draggingTarget
                );
            }
        };

        /**
         * 拖拽在目标元素上完成
         * 
         * @private
         * @param {Object} event 事件对象
         */
        Handler.prototype._processDrop = function (event) {
            if (this._draggingTarget) {
                this._draggingTarget.invisible = false;
                this.storage.mod(this._draggingTarget.id);
                this.painter.refresh();

                // 分发config.EVENT.DROP事件
                this._dispatchAgency(
                    this._lastHover,
                    EVENT.DROP,
                    event,
                    this._draggingTarget
                );
            }
        };

        /**
         * 拖拽结束
         * 
         * @private
         * @param {Object} event 事件对象
         */
        Handler.prototype._processDragEnd = function (event) {
            if (this._draggingTarget) {
                // 分发config.EVENT.DRAGEND事件
                this._dispatchAgency(
                    this._draggingTarget,
                    EVENT.DRAGEND,
                    event
                );

                this._lastHover = null;
            }

            this._isDragging = 0;
            this._draggingTarget = null;
        };

        /**
         * 鼠标在某个图形元素上移动
         * 
         * @private
         * @param {Object} event 事件对象
         */
        Handler.prototype._processOverShape = function (event) {
            // 分发config.EVENT.MOUSEOVER事件
            this._dispatchAgency(this._lastHover, EVENT.MOUSEOVER, event);
        };

        /**
         * 鼠标离开某个图形元素
         * 
         * @private
         * @param {Object} event 事件对象
         */
        Handler.prototype._processOutShape = function (event) {
            // 分发config.EVENT.MOUSEOUT事件
            this._dispatchAgency(this._lastHover, EVENT.MOUSEOUT, event);
        };

        /**
         * 事件分发代理
         * 
         * @private
         * @param {Object} targetShape 目标图形元素
         * @param {string} eventName 事件名称
         * @param {Object} event 事件对象
         * @param {Object=} draggedShape 拖拽事件特有，当前被拖拽图形元素
         */
        Handler.prototype._dispatchAgency = function (targetShape, eventName, event, draggedShape) {
            var eventHandler = 'on' + eventName;
            var eventPacket = {
                type : eventName,
                event : event,
                target : targetShape,
                cancelBubble: false
            };

            var el = targetShape;

            if (draggedShape) {
                eventPacket.dragged = draggedShape;
            }

            while (el) {
                el[eventHandler] 
                && (eventPacket.cancelBubble = el[eventHandler](eventPacket));
                el.dispatch(eventName, eventPacket);

                el = el.parent;
                
                if (eventPacket.cancelBubble) {
                    break;
                }
            }

            if (targetShape) {
                // 冒泡到顶级 zrender 对象
                if (!eventPacket.cancelBubble) {
                    this.dispatch(eventName, eventPacket);
                }
            }
            else if (!draggedShape) {
                // 无hover目标，无拖拽对象，原生事件分发
                var eveObj = {
                    type: eventName,
                    event: event
                };
                this.dispatch(eventName, eveObj);
                // 分发事件到用户自定义层
                this.painter.eachOtherLayer(function (layer) {
                    if (typeof(layer[eventHandler]) == 'function') {
                        layer[eventHandler](eveObj);
                    }
                    if (layer.dispatch) {
                        layer.dispatch(eventName, eveObj);
                    }
                });
            }
        };

        /**
         * 迭代寻找hover shape
         * @private
         * @method
         */
        Handler.prototype._iterateAndFindHover = (function() {
            var invTransform = mat2d.create();
            return function() {
                var list = this.storage.getShapeList();
                var currentZLevel;
                var currentLayer;
                var tmp = [ 0, 0 ];
                for (var i = list.length - 1; i >= 0 ; i--) {
                    var shape = list[i];

                    if (currentZLevel !== shape.zlevel) {
                        currentLayer = this.painter.getLayer(shape.zlevel, currentLayer);
                        tmp[0] = this._mouseX;
                        tmp[1] = this._mouseY;

                        if (currentLayer.needTransform) {
                            mat2d.invert(invTransform, currentLayer.transform);
                            vec2.applyTransform(tmp, tmp, invTransform);
                        }
                    }

                    if (this._findHover(shape, tmp[0], tmp[1])) {
                        break;
                    }
                }
            };
        })();
        
        // touch指尖错觉的尝试偏移量配置
        var MOBILE_TOUCH_OFFSETS = [
            { x: 10 },
            { x: -20 },
            { x: 10, y: 10 },
            { y: -20 }
        ];

        // touch有指尖错觉，四向尝试，让touch上的点击更好触发事件
        Handler.prototype._mobileFindFixed = function (event) {
            this._lastHover = null;
            this._mouseX = event.zrenderX;
            this._mouseY = event.zrenderY;

            this._event = event;

            this._iterateAndFindHover();
            for (var i = 0; !this._lastHover && i < MOBILE_TOUCH_OFFSETS.length ; i++) {
                var offset = MOBILE_TOUCH_OFFSETS[ i ];
                offset.x && (this._mouseX += offset.x);
                offset.y && (this._mouseY += offset.y);

                this._iterateAndFindHover();
            }

            if (this._lastHover) {
                event.zrenderX = this._mouseX;
                event.zrenderY = this._mouseY;
            }
        };

        /**
         * 迭代函数，查找hover到的图形元素并即时做些事件分发
         * 
         * @inner
         * @param {Object} shape 图形元素
         * @param {number} x
         * @param {number} y
         */
        function findHover(shape, x, y) {
            if (
                (this._draggingTarget && this._draggingTarget.id == shape.id) // 迭代到当前拖拽的图形上
                || shape.isSilent() // 打酱油的路过，啥都不响应的shape~
            ) {
                return false;
            }

            var event = this._event;
            if (shape.isCover(x, y)) {
                if (shape.hoverable) {
                    this.storage.addHover(shape);
                }
                // 查找是否在 clipShape 中
                var p = shape.parent;
                while (p) {
                    if (p.clipShape && !p.clipShape.isCover(this._mouseX, this._mouseY))  {
                        // 已经被祖先 clip 掉了
                        return false;
                    }
                    p = p.parent;
                }

                if (this._lastHover != shape) {
                    this._processOutShape(event);

                    // 可能出现config.EVENT.DRAGLEAVE事件
                    this._processDragLeave(event);

                    this._lastHover = shape;

                    // 可能出现config.EVENT.DRAGENTER事件
                    this._processDragEnter(event);
                }

                this._processOverShape(event);

                // 可能出现config.EVENT.DRAGOVER
                this._processDragOver(event);

                this._hasfound = 1;

                return true;    // 找到则中断迭代查找
            }

            return false;
        }

        /**
         * 如果存在第三方嵌入的一些dom触发的事件，或touch事件，需要转换一下事件坐标
         * 
         * @private
         */
        Handler.prototype._zrenderEventFixed = function (event, isTouch) {
            if (event.zrenderFixed) {
                return event;
            }

            if (!isTouch) {
                event = event || window.event;
                // 进入对象优先~
                var target = event.toElement
                              || event.relatedTarget
                              || event.srcElement
                              || event.target;

                if (target && target != this._domHover) {
                    event.zrenderX = (typeof event.offsetX != 'undefined'
                                        ? event.offsetX
                                        : event.layerX)
                                      + target.offsetLeft;
                    event.zrenderY = (typeof event.offsetY != 'undefined'
                                        ? event.offsetY
                                        : event.layerY)
                                      + target.offsetTop;
                }
            }
            else {
                var touch = event.type != 'touchend'
                                ? event.targetTouches[0]
                                : event.changedTouches[0];
                if (touch) {
                    var rBounding = this.painter._domRoot.getBoundingClientRect();
                    // touch事件坐标是全屏的~
                    event.zrenderX = touch.clientX - rBounding.left;
                    event.zrenderY = touch.clientY - rBounding.top;
                }
            }

            event.zrenderFixed = 1;
            return event;
        };

        util.merge(Handler.prototype, Eventful.prototype, true);

        return Handler;
    });
define('zrender/tool/matrix', [], function () {

        var ArrayCtor = typeof Float32Array === 'undefined'
            ? Array
            : Float32Array;
        /**
         * 3x2矩阵操作类
         * @exports zrender/tool/matrix
         */
        var matrix = {
            /**
             * 创建一个单位矩阵
             * @return {Float32Array|Array.<number>}
             */
            create : function() {
                var out = new ArrayCtor(6);
                matrix.identity(out);
                
                return out;
            },
            /**
             * 设置矩阵为单位矩阵
             * @param {Float32Array|Array.<number>} out
             */
            identity : function(out) {
                out[0] = 1;
                out[1] = 0;
                out[2] = 0;
                out[3] = 1;
                out[4] = 0;
                out[5] = 0;
                return out;
            },
            /**
             * 复制矩阵
             * @param {Float32Array|Array.<number>} out
             * @param {Float32Array|Array.<number>} m
             */
            copy: function(out, m) {
                out[0] = m[0];
                out[1] = m[1];
                out[2] = m[2];
                out[3] = m[3];
                out[4] = m[4];
                out[5] = m[5];
                return out;
            },
            /**
             * 矩阵相乘
             * @param {Float32Array|Array.<number>} out
             * @param {Float32Array|Array.<number>} m1
             * @param {Float32Array|Array.<number>} m2
             */
            mul : function (out, m1, m2) {
                out[0] = m1[0] * m2[0] + m1[2] * m2[1];
                out[1] = m1[1] * m2[0] + m1[3] * m2[1];
                out[2] = m1[0] * m2[2] + m1[2] * m2[3];
                out[3] = m1[1] * m2[2] + m1[3] * m2[3];
                out[4] = m1[0] * m2[4] + m1[2] * m2[5] + m1[4];
                out[5] = m1[1] * m2[4] + m1[3] * m2[5] + m1[5];
                return out;
            },
            /**
             * 平移变换
             * @param {Float32Array|Array.<number>} out
             * @param {Float32Array|Array.<number>} a
             * @param {Float32Array|Array.<number>} v
             */
            translate : function(out, a, v) {
                out[0] = a[0];
                out[1] = a[1];
                out[2] = a[2];
                out[3] = a[3];
                out[4] = a[4] + v[0];
                out[5] = a[5] + v[1];
                return out;
            },
            /**
             * 旋转变换
             * @param {Float32Array|Array.<number>} out
             * @param {Float32Array|Array.<number>} a
             * @param {number} rad
             */
            rotate : function(out, a, rad) {
                var aa = a[0];
                var ac = a[2];
                var atx = a[4];
                var ab = a[1];
                var ad = a[3];
                var aty = a[5];
                var st = Math.sin(rad);
                var ct = Math.cos(rad);

                out[0] = aa * ct + ab * st;
                out[1] = -aa * st + ab * ct;
                out[2] = ac * ct + ad * st;
                out[3] = -ac * st + ct * ad;
                out[4] = ct * atx + st * aty;
                out[5] = ct * aty - st * atx;
                return out;
            },
            /**
             * 缩放变换
             * @param {Float32Array|Array.<number>} out
             * @param {Float32Array|Array.<number>} a
             * @param {Float32Array|Array.<number>} v
             */
            scale : function(out, a, v) {
                var vx = v[0];
                var vy = v[1];
                out[0] = a[0] * vx;
                out[1] = a[1] * vy;
                out[2] = a[2] * vx;
                out[3] = a[3] * vy;
                out[4] = a[4] * vx;
                out[5] = a[5] * vy;
                return out;
            },
            /**
             * 求逆矩阵
             * @param {Float32Array|Array.<number>} out
             * @param {Float32Array|Array.<number>} a
             */
            invert : function(out, a) {
            
                var aa = a[0];
                var ac = a[2];
                var atx = a[4];
                var ab = a[1];
                var ad = a[3];
                var aty = a[5];

                var det = aa * ad - ab * ac;
                if (!det) {
                    return null;
                }
                det = 1.0 / det;

                out[0] = ad * det;
                out[1] = -ab * det;
                out[2] = -ac * det;
                out[3] = aa * det;
                out[4] = (ac * aty - ad * atx) * det;
                out[5] = (ab * atx - aa * aty) * det;
                return out;
            }
        };

        return matrix;
    });
define('zrender/tool/vector', [], function () {
        var ArrayCtor = typeof Float32Array === 'undefined'
            ? Array
            : Float32Array;

        /**
         * @typedef {Float32Array|Array.<number>} Vector2
         */
        /**
         * 二维向量类
         * @exports zrender/tool/vector
         */
        var vector = {
            /**
             * 创建一个向量
             * @param {number} [x=0]
             * @param {number} [y=0]
             * @return {Vector2}
             */
            create: function (x, y) {
                var out = new ArrayCtor(2);
                out[0] = x || 0;
                out[1] = y || 0;
                return out;
            },

            /**
             * 复制向量数据
             * @param {Vector2} out
             * @param {Vector2} v
             * @return {Vector2}
             */
            copy: function (out, v) {
                out[0] = v[0];
                out[1] = v[1];
                return out;
            },

            /**
             * 克隆一个向量
             * @param {Vector2} v
             * @return {Vector2}
             */
            clone: function (v) {
                var out = new ArrayCtor(2);
                out[0] = v[0];
                out[1] = v[1];
                return out;
            },

            /**
             * 设置向量的两个项
             * @param {Vector2} out
             * @param {number} a
             * @param {number} b
             * @return {Vector2} 结果
             */
            set: function (out, a, b) {
                out[0] = a;
                out[1] = b;
                return out;
            },

            /**
             * 向量相加
             * @param {Vector2} out
             * @param {Vector2} v1
             * @param {Vector2} v2
             */
            add: function (out, v1, v2) {
                out[0] = v1[0] + v2[0];
                out[1] = v1[1] + v2[1];
                return out;
            },

            /**
             * 向量缩放后相加
             * @param {Vector2} out
             * @param {Vector2} v1
             * @param {Vector2} v2
             * @param {number} a
             */
            scaleAndAdd: function (out, v1, v2, a) {
                out[0] = v1[0] + v2[0] * a;
                out[1] = v1[1] + v2[1] * a;
                return out;
            },

            /**
             * 向量相减
             * @param {Vector2} out
             * @param {Vector2} v1
             * @param {Vector2} v2
             */
            sub: function (out, v1, v2) {
                out[0] = v1[0] - v2[0];
                out[1] = v1[1] - v2[1];
                return out;
            },

            /**
             * 向量长度
             * @param {Vector2} v
             * @return {number}
             */
            len: function (v) {
                return Math.sqrt(this.lenSquare(v));
            },

            /**
             * 向量长度平方
             * @param {Vector2} v
             * @return {number}
             */
            lenSquare: function (v) {
                return v[0] * v[0] + v[1] * v[1];
            },

            /**
             * 向量乘法
             * @param {Vector2} out
             * @param {Vector2} v1
             * @param {Vector2} v2
             */
            mul: function (out, v1, v2) {
                out[0] = v1[0] * v2[0];
                out[1] = v1[1] * v2[1];
                return out;
            },

            /**
             * 向量除法
             * @param {Vector2} out
             * @param {Vector2} v1
             * @param {Vector2} v2
             */
            div: function (out, v1, v2) {
                out[0] = v1[0] / v2[0];
                out[1] = v1[1] / v2[1];
                return out;
            },

            /**
             * 向量点乘
             * @param {Vector2} v1
             * @param {Vector2} v2
             * @return {number}
             */
            dot: function (v1, v2) {
                return v1[0] * v2[0] + v1[1] * v2[1];
            },

            /**
             * 向量缩放
             * @param {Vector2} out
             * @param {Vector2} v
             * @param {number} s
             */
            scale: function (out, v, s) {
                out[0] = v[0] * s;
                out[1] = v[1] * s;
                return out;
            },

            /**
             * 向量归一化
             * @param {Vector2} out
             * @param {Vector2} v
             */
            normalize: function (out, v) {
                var d = vector.len(v);
                if (d === 0) {
                    out[0] = 0;
                    out[1] = 0;
                }
                else {
                    out[0] = v[0] / d;
                    out[1] = v[1] / d;
                }
                return out;
            },

            /**
             * 计算向量间距离
             * @param {Vector2} v1
             * @param {Vector2} v2
             * @return {number}
             */
            distance: function (v1, v2) {
                return Math.sqrt(
                    (v1[0] - v2[0]) * (v1[0] - v2[0])
                    + (v1[1] - v2[1]) * (v1[1] - v2[1])
                );
            },

            /**
             * 向量距离平方
             * @param {Vector2} v1
             * @param {Vector2} v2
             * @return {number}
             */
            distanceSquare: function (v1, v2) {
                return (v1[0] - v2[0]) * (v1[0] - v2[0])
                    + (v1[1] - v2[1]) * (v1[1] - v2[1]);
            },

            /**
             * 求负向量
             * @param {Vector2} out
             * @param {Vector2} v
             */
            negate: function (out, v) {
                out[0] = -v[0];
                out[1] = -v[1];
                return out;
            },

            /**
             * 插值两个点
             * @param {Vector2} out
             * @param {Vector2} v1
             * @param {Vector2} v2
             * @param {number} t
             */
            lerp: function (out, v1, v2, t) {
                // var ax = v1[0];
                // var ay = v1[1];
                out[0] = v1[0] + t * (v2[0] - v1[0]);
                out[1] = v1[1] + t * (v2[1] - v1[1]);
                return out;
            },
            
            /**
             * 矩阵左乘向量
             * @param {Vector2} out
             * @param {Vector2} v
             * @param {Vector2} m
             */
            applyTransform: function (out, v, m) {
                var x = v[0];
                var y = v[1];
                out[0] = m[0] * x + m[2] * y + m[4];
                out[1] = m[1] * x + m[3] * y + m[5];
                return out;
            },
            /**
             * 求两个向量最小值
             * @param  {Vector2} out
             * @param  {Vector2} v1
             * @param  {Vector2} v2
             */
            min: function (out, v1, v2) {
                out[0] = Math.min(v1[0], v2[0]);
                out[1] = Math.min(v1[1], v2[1]);
                return out;
            },
            /**
             * 求两个向量最大值
             * @param  {Vector2} out
             * @param  {Vector2} v1
             * @param  {Vector2} v2
             */
            max: function (out, v1, v2) {
                out[0] = Math.max(v1[0], v2[0]);
                out[1] = Math.max(v1[1], v2[1]);
                return out;
            }
        };

        vector.length = vector.len;
        vector.lengthSquare = vector.lenSquare;
        vector.dist = vector.distance;
        vector.distSquare = vector.distanceSquare;
        
        return vector;
    });
define('zrender/mixin/Transformable', ['require', '../tool/matrix', '../tool/vector'], function (require) {

    'use strict';

    var matrix = require('../tool/matrix');
    var vector = require('../tool/vector');
    var origin = [0, 0];

    var mTranslate = matrix.translate;

    var EPSILON = 5e-5;

    function isAroundZero(val) {
        return val > -EPSILON && val < EPSILON;
    }
    function isNotAroundZero(val) {
        return val > EPSILON || val < -EPSILON;
    }

    /**
     * @alias module:zrender/mixin/Transformable
     * @constructor
     */
    var Transformable = function () {

        if (!this.position) {
            /**
             * 平移
             * @type {Array.<number>}
             * @default [0, 0]
             */
            this.position = [ 0, 0 ];
        }
        if (typeof(this.rotation) == 'undefined') {
            /**
             * 旋转，可以通过数组二三项指定旋转的原点
             * @type {Array.<number>}
             * @default [0, 0, 0]
             */
            this.rotation = [ 0, 0, 0 ];
        }
        if (!this.scale) {
            /**
             * 缩放，可以通过数组三四项指定缩放的原点
             * @type {Array.<number>}
             * @default [1, 1, 0, 0]
             */
            this.scale = [ 1, 1, 0, 0 ];
        }

        this.needLocalTransform = false;

        /**
         * 是否有坐标变换
         * @type {boolean}
         * @readOnly
         */
        this.needTransform = false;
    };

    Transformable.prototype = {
        
        constructor: Transformable,

        updateNeedTransform: function () {
            this.needLocalTransform = isNotAroundZero(this.rotation[0])
                || isNotAroundZero(this.position[0])
                || isNotAroundZero(this.position[1])
                || isNotAroundZero(this.scale[0] - 1)
                || isNotAroundZero(this.scale[1] - 1);
        },

        /**
         * 判断是否需要有坐标变换，更新needTransform属性。
         * 如果有坐标变换, 则从position, rotation, scale以及父节点的transform计算出自身的transform矩阵
         */
        updateTransform: function () {
            
            this.updateNeedTransform();

            var parentHasTransform = this.parent && this.parent.needTransform;
            this.needTransform = this.needLocalTransform || parentHasTransform;
            
            if (!this.needTransform) {
                return;
            }

            var m = this.transform || matrix.create();
            matrix.identity(m);

            if (this.needLocalTransform) {
                var scale = this.scale;
                if (
                    isNotAroundZero(scale[0])
                 || isNotAroundZero(scale[1])
                ) {
                    origin[0] = -scale[2] || 0;
                    origin[1] = -scale[3] || 0;
                    var haveOrigin = isNotAroundZero(origin[0])
                                  || isNotAroundZero(origin[1]);
                    if (haveOrigin) {
                        mTranslate(m, m, origin);
                    }
                    matrix.scale(m, m, scale);
                    if (haveOrigin) {
                        origin[0] = -origin[0];
                        origin[1] = -origin[1];
                        mTranslate(m, m, origin);
                    }
                }

                if (this.rotation instanceof Array) {
                    if (this.rotation[0] !== 0) {
                        origin[0] = -this.rotation[1] || 0;
                        origin[1] = -this.rotation[2] || 0;
                        var haveOrigin = isNotAroundZero(origin[0])
                                      || isNotAroundZero(origin[1]);
                        if (haveOrigin) {
                            mTranslate(m, m, origin);
                        }
                        matrix.rotate(m, m, this.rotation[0]);
                        if (haveOrigin) {
                            origin[0] = -origin[0];
                            origin[1] = -origin[1];
                            mTranslate(m, m, origin);
                        }
                    }
                }
                else {
                    if (this.rotation !== 0) {
                        matrix.rotate(m, m, this.rotation);
                    }
                }

                if (
                    isNotAroundZero(this.position[0]) || isNotAroundZero(this.position[1])
                ) {
                    mTranslate(m, m, this.position);
                }
            }

            // 应用父节点变换
            if (parentHasTransform) {
                if (this.needLocalTransform) {
                    matrix.mul(m, this.parent.transform, m);
                }
                else {
                    matrix.copy(m, this.parent.transform);
                }
            }
            // 保存这个变换矩阵
            this.transform = m;

            this.invTransform = this.invTransform || matrix.create();
            matrix.invert(this.invTransform, m);
        },
        /**
         * 将自己的transform应用到context上
         * @param {Context2D} ctx
         */
        setTransform: function (ctx) {
            if (this.needTransform) {
                var m = this.transform;
                ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
            }
        },
        /**
         * 设置图形的朝向
         * @param  {Array.<number>|Float32Array} target
         * @method
         */
        lookAt: (function () {
            var v = vector.create();
            return function(target) {
                if (!this.transform) {
                    this.transform = matrix.create();
                }
                var m = this.transform;
                vector.sub(v, target, this.position);
                if (isAroundZero(v[0]) && isAroundZero(v[1])) {
                    return;
                }
                vector.normalize(v, v);
                var scale = this.scale;
                // Y Axis
                // TODO Scale origin ?
                m[2] = v[0] * scale[1];
                m[3] = v[1] * scale[1];
                // X Axis
                m[0] = v[1] * scale[0];
                m[1] = -v[0] * scale[0];
                // Position
                m[4] = this.position[0];
                m[5] = this.position[1];

                this.decomposeTransform();
            };
        })(),
        /**
         * 分解`transform`矩阵到`position`, `rotation`, `scale`
         */
        decomposeTransform: function () {
            if (!this.transform) {
                return;
            }
            var m = this.transform;
            var sx = m[0] * m[0] + m[1] * m[1];
            var position = this.position;
            var scale = this.scale;
            var rotation = this.rotation;
            if (isNotAroundZero(sx - 1)) {
                sx = Math.sqrt(sx);
            }
            var sy = m[2] * m[2] + m[3] * m[3];
            if (isNotAroundZero(sy - 1)) {
                sy = Math.sqrt(sy);
            }
            position[0] = m[4];
            position[1] = m[5];
            scale[0] = sx;
            scale[1] = sy;
            scale[2] = scale[3] = 0;
            rotation[0] = Math.atan2(-m[1] / sy, m[0] / sx);
            rotation[1] = rotation[2] = 0;
        },

        /**
         * 变换坐标位置到 shape 的局部坐标空间
         * @method
         * @param {number} x
         * @param {number} y
         * @return {Array.<number>}
         */
        transformCoordToLocal: function (x, y) {
            var v2 = [x, y];
            if (this.needTransform && this.invTransform) {
                vector.applyTransform(v2, v2, this.invTransform);
            }
            return v2;
        }
    };

    return Transformable;
});
define('zrender/loadingEffect/Base', ['require', '../tool/util', '../shape/Text', '../shape/Rectangle'], function (require) {
        var util = require('../tool/util');
        var TextShape = require('../shape/Text');
        var RectangleShape = require('../shape/Rectangle');


        var DEFAULT_TEXT = 'Loading...';
        var DEFAULT_TEXT_FONT = 'normal 16px Arial';

        /**
         * @constructor
         * 
         * @param {Object} options 选项
         * @param {color} options.backgroundColor 背景颜色
         * @param {Object} options.textStyle 文字样式，同shape/text.style
         * @param {number=} options.progress 进度参数，部分特效有用
         * @param {Object=} options.effect 特效参数，部分特效有用
         * 
         * {
         *     effect,
         *     //loading话术
         *     text:'',
         *     // 水平安放位置，默认为 'center'，可指定x坐标
         *     x:'center' || 'left' || 'right' || {number},
         *     // 垂直安放位置，默认为'top'，可指定y坐标
         *     y:'top' || 'bottom' || {number},
         *
         *     textStyle:{
         *         textFont: 'normal 20px Arial' || {textFont}, //文本字体
         *         color: {color}
         *     }
         * }
         */
        function Base(options) {
            this.setOptions(options);
        }

        /**
         * 创建loading文字图形
         * 
         * @param {Object} textStyle 文字style，同shape/text.style
         */
        Base.prototype.createTextShape = function (textStyle) {
            return new TextShape({
                highlightStyle : util.merge(
                    {
                        x : this.canvasWidth / 2,
                        y : this.canvasHeight / 2,
                        text : DEFAULT_TEXT,
                        textAlign : 'center',
                        textBaseline : 'middle',
                        textFont : DEFAULT_TEXT_FONT,
                        color: '#333',
                        brushType : 'fill'
                    },
                    textStyle,
                    true
                )
            });
        };
        
        /**
         * 获取loading背景图形
         * 
         * @param {color} color 背景颜色
         */
        Base.prototype.createBackgroundShape = function (color) {
            return new RectangleShape({
                highlightStyle : {
                    x : 0,
                    y : 0,
                    width : this.canvasWidth,
                    height : this.canvasHeight,
                    brushType : 'fill',
                    color : color
                }
            });
        };

        Base.prototype.start = function (painter) {
            this.canvasWidth = painter._width;
            this.canvasHeight = painter._height;

            function addShapeHandle(param) {
                painter.storage.addHover(param);
            }
            function refreshHandle() {
                painter.refreshHover();
            }
            this.loadingTimer = this._start(addShapeHandle, refreshHandle);
        };

        Base.prototype._start = function (/*addShapeHandle, refreshHandle*/) {
            return setInterval(function () {
            }, 10000);
        };

        Base.prototype.stop = function () {
            clearInterval(this.loadingTimer);
        };

        Base.prototype.setOptions = function (options) {
            this.options = options || {};
        };
        
        Base.prototype.adjust = function (value, region) {
            if (value <= region[0]) {
                value = region[0];
            }
            else if (value >= region[1]) {
                value = region[1];
            }
            return value;
        };
        
        Base.prototype.getLocation = function(loc, totalWidth, totalHeight) {
            var x = loc.x != null ? loc.x : 'center';
            switch (x) {
                case 'center' :
                    x = Math.floor((this.canvasWidth - totalWidth) / 2);
                    break;
                case 'left' :
                    x = 0;
                    break;
                case 'right' :
                    x = this.canvasWidth - totalWidth;
                    break;
            }
            var y = loc.y != null ? loc.y : 'center';
            switch (y) {
                case 'center' :
                    y = Math.floor((this.canvasHeight - totalHeight) / 2);
                    break;
                case 'top' :
                    y = 0;
                    break;
                case 'bottom' :
                    y = this.canvasHeight - totalHeight;
                    break;
            }
            return {
                x : x,
                y : y,
                width : totalWidth,
                height : totalHeight
            };
        };

        return Base;
    });
define('zrender/tool/curve', ['require', './vector'], function (require) {

    var vector = require('./vector');

    'use strict';

    var EPSILON = 1e-4;

    var THREE_SQRT = Math.sqrt(3);
    var ONE_THIRD = 1 / 3;

    // 临时变量
    var _v0 = vector.create();
    var _v1 = vector.create();
    var _v2 = vector.create();
    // var _v3 = vector.create();

    function isAroundZero(val) {
        return val > -EPSILON && val < EPSILON;
    }
    function isNotAroundZero(val) {
        return val > EPSILON || val < -EPSILON;
    }
    /*
    function evalCubicCoeff(a, b, c, d, t) {
        return ((a * t + b) * t + c) * t + d;
    }
    */

    /** 
     * 计算三次贝塞尔值
     * @memberOf module:zrender/tool/curve
     * @param  {number} p0
     * @param  {number} p1
     * @param  {number} p2
     * @param  {number} p3
     * @param  {number} t
     * @return {number}
     */
    function cubicAt(p0, p1, p2, p3, t) {
        var onet = 1 - t;
        return onet * onet * (onet * p0 + 3 * t * p1)
             + t * t * (t * p3 + 3 * onet * p2);
    }

    /** 
     * 计算三次贝塞尔导数值
     * @memberOf module:zrender/tool/curve
     * @param  {number} p0
     * @param  {number} p1
     * @param  {number} p2
     * @param  {number} p3
     * @param  {number} t
     * @return {number}
     */
    function cubicDerivativeAt(p0, p1, p2, p3, t) {
        var onet = 1 - t;
        return 3 * (
            ((p1 - p0) * onet + 2 * (p2 - p1) * t) * onet
            + (p3 - p2) * t * t
        );
    }

    /**
     * 计算三次贝塞尔方程根，使用盛金公式
     * @memberOf module:zrender/tool/curve
     * @param  {number} p0
     * @param  {number} p1
     * @param  {number} p2
     * @param  {number} p3
     * @param  {number} val
     * @param  {Array.<number>} roots
     * @return {number} 有效根数目
     */
    function cubicRootAt(p0, p1, p2, p3, val, roots) {
        // Evaluate roots of cubic functions
        var a = p3 + 3 * (p1 - p2) - p0;
        var b = 3 * (p2 - p1 * 2 + p0);
        var c = 3 * (p1  - p0);
        var d = p0 - val;

        var A = b * b - 3 * a * c;
        var B = b * c - 9 * a * d;
        var C = c * c - 3 * b * d;

        var n = 0;

        if (isAroundZero(A) && isAroundZero(B)) {
            if (isAroundZero(b)) {
                roots[0] = 0;
            }
            else {
                var t1 = -c / b;  //t1, t2, t3, b is not zero
                if (t1 >= 0 && t1 <= 1) {
                    roots[n++] = t1;
                }
            }
        }
        else {
            var disc = B * B - 4 * A * C;

            if (isAroundZero(disc)) {
                var K = B / A;
                var t1 = -b / a + K;  // t1, a is not zero
                var t2 = -K / 2;  // t2, t3
                if (t1 >= 0 && t1 <= 1) {
                    roots[n++] = t1;
                }
                if (t2 >= 0 && t2 <= 1) {
                    roots[n++] = t2;
                }
            }
            else if (disc > 0) {
                var discSqrt = Math.sqrt(disc);
                var Y1 = A * b + 1.5 * a * (-B + discSqrt);
                var Y2 = A * b + 1.5 * a * (-B - discSqrt);
                if (Y1 < 0) {
                    Y1 = -Math.pow(-Y1, ONE_THIRD);
                }
                else {
                    Y1 = Math.pow(Y1, ONE_THIRD);
                }
                if (Y2 < 0) {
                    Y2 = -Math.pow(-Y2, ONE_THIRD);
                }
                else {
                    Y2 = Math.pow(Y2, ONE_THIRD);
                }
                var t1 = (-b - (Y1 + Y2)) / (3 * a);
                if (t1 >= 0 && t1 <= 1) {
                    roots[n++] = t1;
                }
            }
            else {
                var T = (2 * A * b - 3 * a * B) / (2 * Math.sqrt(A * A * A));
                var theta = Math.acos(T) / 3;
                var ASqrt = Math.sqrt(A);
                var tmp = Math.cos(theta);
                
                var t1 = (-b - 2 * ASqrt * tmp) / (3 * a);
                var t2 = (-b + ASqrt * (tmp + THREE_SQRT * Math.sin(theta))) / (3 * a);
                var t3 = (-b + ASqrt * (tmp - THREE_SQRT * Math.sin(theta))) / (3 * a);
                if (t1 >= 0 && t1 <= 1) {
                    roots[n++] = t1;
                }
                if (t2 >= 0 && t2 <= 1) {
                    roots[n++] = t2;
                }
                if (t3 >= 0 && t3 <= 1) {
                    roots[n++] = t3;
                }
            }
        }
        return n;
    }

    /**
     * 计算三次贝塞尔方程极限值的位置
     * @memberOf module:zrender/tool/curve
     * @param  {number} p0
     * @param  {number} p1
     * @param  {number} p2
     * @param  {number} p3
     * @param  {Array.<number>} extrema
     * @return {number} 有效数目
     */
    function cubicExtrema(p0, p1, p2, p3, extrema) {
        var b = 6 * p2 - 12 * p1 + 6 * p0;
        var a = 9 * p1 + 3 * p3 - 3 * p0 - 9 * p2;
        var c = 3 * p1 - 3 * p0;

        var n = 0;
        if (isAroundZero(a)) {
            if (isNotAroundZero(b)) {
                var t1 = -c / b;
                if (t1 >= 0 && t1 <=1) {
                    extrema[n++] = t1;
                }
            }
        }
        else {
            var disc = b * b - 4 * a * c;
            if (isAroundZero(disc)) {
                extrema[0] = -b / (2 * a);
            }
            else if (disc > 0) {
                var discSqrt = Math.sqrt(disc);
                var t1 = (-b + discSqrt) / (2 * a);
                var t2 = (-b - discSqrt) / (2 * a);
                if (t1 >= 0 && t1 <= 1) {
                    extrema[n++] = t1;
                }
                if (t2 >= 0 && t2 <= 1) {
                    extrema[n++] = t2;
                }
            }
        }
        return n;
    }

    /**
     * 细分三次贝塞尔曲线
     * @memberOf module:zrender/tool/curve
     * @param  {number} p0
     * @param  {number} p1
     * @param  {number} p2
     * @param  {number} p3
     * @param  {number} t
     * @param  {Array.<number>} out
     */
    function cubicSubdivide(p0, p1, p2, p3, t, out) {
        var p01 = (p1 - p0) * t + p0;
        var p12 = (p2 - p1) * t + p1;
        var p23 = (p3 - p2) * t + p2;

        var p012 = (p12 - p01) * t + p01;
        var p123 = (p23 - p12) * t + p12;

        var p0123 = (p123 - p012) * t + p012;
        // Seg0
        out[0] = p0;
        out[1] = p01;
        out[2] = p012;
        out[3] = p0123;
        // Seg1
        out[4] = p0123;
        out[5] = p123;
        out[6] = p23;
        out[7] = p3;
    }

    /**
     * 投射点到三次贝塞尔曲线上，返回投射距离。
     * 投射点有可能会有一个或者多个，这里只返回其中距离最短的一个。
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @param {number} x3
     * @param {number} y3
     * @param {number} x
     * @param {number} y
     * @param {Array.<number>} [out] 投射点
     * @return {number}
     */
    function cubicProjectPoint(
        x0, y0, x1, y1, x2, y2, x3, y3,
        x, y, out
    ) {
        // http://pomax.github.io/bezierinfo/#projections
        var t;
        var interval = 0.005;
        var d = Infinity;

        _v0[0] = x;
        _v0[1] = y;

        // 先粗略估计一下可能的最小距离的 t 值
        // PENDING
        for (var _t = 0; _t < 1; _t += 0.05) {
            _v1[0] = cubicAt(x0, x1, x2, x3, _t);
            _v1[1] = cubicAt(y0, y1, y2, y3, _t);
            var d1 = vector.distSquare(_v0, _v1);
            if (d1 < d) {
                t = _t;
                d = d1;
            }
        }
        d = Infinity;

        // At most 32 iteration
        for (var i = 0; i < 32; i++) {
            if (interval < EPSILON) {
                break;
            }
            var prev = t - interval;
            var next = t + interval;
            // t - interval
            _v1[0] = cubicAt(x0, x1, x2, x3, prev);
            _v1[1] = cubicAt(y0, y1, y2, y3, prev);

            var d1 = vector.distSquare(_v1, _v0);

            if (prev >= 0 && d1 < d) {
                t = prev;
                d = d1;
            }
            else {
                // t + interval
                _v2[0] = cubicAt(x0, x1, x2, x3, next);
                _v2[1] = cubicAt(y0, y1, y2, y3, next);
                var d2 = vector.distSquare(_v2, _v0);

                if (next <= 1 && d2 < d) {
                    t = next;
                    d = d2;
                }
                else {
                    interval *= 0.5;
                }
            }
        }
        // t
        if (out) {
            out[0] = cubicAt(x0, x1, x2, x3, t);
            out[1] = cubicAt(y0, y1, y2, y3, t);   
        }
        // console.log(interval, i);
        return Math.sqrt(d);
    }

    /**
     * 计算二次方贝塞尔值
     * @param  {number} p0
     * @param  {number} p1
     * @param  {number} p2
     * @param  {number} t
     * @return {number}
     */
    function quadraticAt(p0, p1, p2, t) {
        var onet = 1 - t;
        return onet * (onet * p0 + 2 * t * p1) + t * t * p2;
    }

    /**
     * 计算二次方贝塞尔导数值
     * @param  {number} p0
     * @param  {number} p1
     * @param  {number} p2
     * @param  {number} t
     * @return {number}
     */
    function quadraticDerivativeAt(p0, p1, p2, t) {
        return 2 * ((1 - t) * (p1 - p0) + t * (p2 - p1));
    }

    /**
     * 计算二次方贝塞尔方程根
     * @param  {number} p0
     * @param  {number} p1
     * @param  {number} p2
     * @param  {number} t
     * @param  {Array.<number>} roots
     * @return {number} 有效根数目
     */
    function quadraticRootAt(p0, p1, p2, val, roots) {
        var a = p0 - 2 * p1 + p2;
        var b = 2 * (p1 - p0);
        var c = p0 - val;

        var n = 0;
        if (isAroundZero(a)) {
            if (isNotAroundZero(b)) {
                var t1 = -c / b;
                if (t1 >= 0 && t1 <= 1) {
                    roots[n++] = t1;
                }
            }
        }
        else {
            var disc = b * b - 4 * a * c;
            if (isAroundZero(disc)) {
                var t1 = -b / (2 * a);
                if (t1 >= 0 && t1 <= 1) {
                    roots[n++] = t1;
                }
            }
            else if (disc > 0) {
                var discSqrt = Math.sqrt(disc);
                var t1 = (-b + discSqrt) / (2 * a);
                var t2 = (-b - discSqrt) / (2 * a);
                if (t1 >= 0 && t1 <= 1) {
                    roots[n++] = t1;
                }
                if (t2 >= 0 && t2 <= 1) {
                    roots[n++] = t2;
                }
            }
        }
        return n;
    }

    /**
     * 计算二次贝塞尔方程极限值
     * @memberOf module:zrender/tool/curve
     * @param  {number} p0
     * @param  {number} p1
     * @param  {number} p2
     * @return {number}
     */
    function quadraticExtremum(p0, p1, p2) {
        var divider = p0 + p2 - 2 * p1;
        if (divider === 0) {
            // p1 is center of p0 and p2 
            return 0.5;
        }
        else {
            return (p0 - p1) / divider;
        }
    }

    /**
     * 细分二次贝塞尔曲线
     * @memberOf module:zrender/tool/curve
     * @param  {number} p0
     * @param  {number} p1
     * @param  {number} p2
     * @param  {number} t
     * @param  {Array.<number>} out
     */
    function quadraticSubdivide(p0, p1, p2, t, out) {
        var p01 = (p1 - p0) * t + p0;
        var p12 = (p2 - p1) * t + p1;
        var p012 = (p12 - p01) * t + p01;

        // Seg0
        out[0] = p0;
        out[1] = p01;
        out[2] = p012;

        // Seg1
        out[3] = p012;
        out[4] = p12;
        out[5] = p2;
    }

    /**
     * 投射点到二次贝塞尔曲线上，返回投射距离。
     * 投射点有可能会有一个或者多个，这里只返回其中距离最短的一个。
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @param {number} x
     * @param {number} y
     * @param {Array.<number>} out 投射点
     * @return {number}
     */
    function quadraticProjectPoint(
        x0, y0, x1, y1, x2, y2,
        x, y, out
    ) {
        // http://pomax.github.io/bezierinfo/#projections
        var t;
        var interval = 0.005;
        var d = Infinity;

        _v0[0] = x;
        _v0[1] = y;

        // 先粗略估计一下可能的最小距离的 t 值
        // PENDING
        for (var _t = 0; _t < 1; _t += 0.05) {
            _v1[0] = quadraticAt(x0, x1, x2, _t);
            _v1[1] = quadraticAt(y0, y1, y2, _t);
            var d1 = vector.distSquare(_v0, _v1);
            if (d1 < d) {
                t = _t;
                d = d1;
            }
        }
        d = Infinity;

        // At most 32 iteration
        for (var i = 0; i < 32; i++) {
            if (interval < EPSILON) {
                break;
            }
            var prev = t - interval;
            var next = t + interval;
            // t - interval
            _v1[0] = quadraticAt(x0, x1, x2, prev);
            _v1[1] = quadraticAt(y0, y1, y2, prev);

            var d1 = vector.distSquare(_v1, _v0);

            if (prev >= 0 && d1 < d) {
                t = prev;
                d = d1;
            }
            else {
                // t + interval
                _v2[0] = quadraticAt(x0, x1, x2, next);
                _v2[1] = quadraticAt(y0, y1, y2, next);
                var d2 = vector.distSquare(_v2, _v0);
                if (next <= 1 && d2 < d) {
                    t = next;
                    d = d2;
                }
                else {
                    interval *= 0.5;
                }
            }
        }
        // t
        if (out) {
            out[0] = quadraticAt(x0, x1, x2, t);
            out[1] = quadraticAt(y0, y1, y2, t);   
        }
        // console.log(interval, i);
        return Math.sqrt(d);
    }

    return {

        cubicAt: cubicAt,

        cubicDerivativeAt: cubicDerivativeAt,

        cubicRootAt: cubicRootAt,

        cubicExtrema: cubicExtrema,

        cubicSubdivide: cubicSubdivide,

        cubicProjectPoint: cubicProjectPoint,

        quadraticAt: quadraticAt,

        quadraticDerivativeAt: quadraticDerivativeAt,

        quadraticRootAt: quadraticRootAt,

        quadraticExtremum: quadraticExtremum,

        quadraticSubdivide: quadraticSubdivide,

        quadraticProjectPoint: quadraticProjectPoint
    };
});
define('zrender/shape/Rectangle', ['require', './Base', '../tool/util'], function (require) {
        var Base = require('./Base');
        
        /**
         * @alias module:zrender/shape/Rectangle
         * @constructor
         * @extends module:zrender/shape/Base
         * @param {Object} options
         */
        var Rectangle = function (options) {
            Base.call(this, options);
            /**
             * 矩形绘制样式
             * @name module:zrender/shape/Rectangle#style
             * @type {module:zrender/shape/Rectangle~IRectangleStyle}
             */
            /**
             * 矩形高亮绘制样式
             * @name module:zrender/shape/Rectangle#highlightStyle
             * @type {module:zrender/shape/Rectangle~IRectangleStyle}
             */
        };

        Rectangle.prototype =  {
            type: 'rectangle',

            _buildRadiusPath: function (ctx, style) {
                // 左上、右上、右下、左下角的半径依次为r1、r2、r3、r4
                // r缩写为1         相当于 [1, 1, 1, 1]
                // r缩写为[1]       相当于 [1, 1, 1, 1]
                // r缩写为[1, 2]    相当于 [1, 2, 1, 2]
                // r缩写为[1, 2, 3] 相当于 [1, 2, 3, 2]
                var x = style.x;
                var y = style.y;
                var width = style.width;
                var height = style.height;
                var r = style.radius;
                var r1; 
                var r2; 
                var r3; 
                var r4;
                  
                if (typeof r === 'number') {
                    r1 = r2 = r3 = r4 = r;
                }
                else if (r instanceof Array) {
                    if (r.length === 1) {
                        r1 = r2 = r3 = r4 = r[0];
                    }
                    else if (r.length === 2) {
                        r1 = r3 = r[0];
                        r2 = r4 = r[1];
                    }
                    else if (r.length === 3) {
                        r1 = r[0];
                        r2 = r4 = r[1];
                        r3 = r[2];
                    }
                    else {
                        r1 = r[0];
                        r2 = r[1];
                        r3 = r[2];
                        r4 = r[3];
                    }
                }
                else {
                    r1 = r2 = r3 = r4 = 0;
                }
                
                var total;
                if (r1 + r2 > width) {
                    total = r1 + r2;
                    r1 *= width / total;
                    r2 *= width / total;
                }
                if (r3 + r4 > width) {
                    total = r3 + r4;
                    r3 *= width / total;
                    r4 *= width / total;
                }
                if (r2 + r3 > height) {
                    total = r2 + r3;
                    r2 *= height / total;
                    r3 *= height / total;
                }
                if (r1 + r4 > height) {
                    total = r1 + r4;
                    r1 *= height / total;
                    r4 *= height / total;
                }
                ctx.moveTo(x + r1, y);
                ctx.lineTo(x + width - r2, y);
                r2 !== 0 && ctx.quadraticCurveTo(
                    x + width, y, x + width, y + r2
                );
                ctx.lineTo(x + width, y + height - r3);
                r3 !== 0 && ctx.quadraticCurveTo(
                    x + width, y + height, x + width - r3, y + height
                );
                ctx.lineTo(x + r4, y + height);
                r4 !== 0 && ctx.quadraticCurveTo(
                    x, y + height, x, y + height - r4
                );
                ctx.lineTo(x, y + r1);
                r1 !== 0 && ctx.quadraticCurveTo(x, y, x + r1, y);
            },
            
            /**
             * 创建矩形路径
             * @param {CanvasRenderingContext2D} ctx
             * @param {Object} style
             */
            buildPath : function (ctx, style) {
                if (!style.radius) {
                    ctx.moveTo(style.x, style.y);
                    ctx.lineTo(style.x + style.width, style.y);
                    ctx.lineTo(style.x + style.width, style.y + style.height);
                    ctx.lineTo(style.x, style.y + style.height);
                    ctx.lineTo(style.x, style.y);
                    // ctx.rect(style.x, style.y, style.width, style.height);
                }
                else {
                    this._buildRadiusPath(ctx, style);
                }
                ctx.closePath();
                return;
            },

            /**
             * 计算返回矩形包围盒矩阵
             * @param {module:zrender/shape/Rectangle~IRectangleStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function(style) {
                if (style.__rect) {
                    return style.__rect;
                }
                
                var lineWidth;
                if (style.brushType == 'stroke' || style.brushType == 'fill') {
                    lineWidth = style.lineWidth || 1;
                }
                else {
                    lineWidth = 0;
                }
                style.__rect = {
                    x : Math.round(style.x - lineWidth / 2),
                    y : Math.round(style.y - lineWidth / 2),
                    width : style.width + lineWidth,
                    height : style.height + lineWidth
                };
                
                return style.__rect;
            }
        };

        require('../tool/util').inherits(Rectangle, Base);
        return Rectangle;
    });
define('zrender/Layer', ['require', './mixin/Transformable', './tool/util', './config'], function (require) {

    var Transformable = require('./mixin/Transformable');
    var util = require('./tool/util');
    var vmlCanvasManager = window['G_vmlCanvasManager'];
    var config = require('./config');

    function returnFalse() {
        return false;
    }

    /**
     * 创建dom
     * 
     * @inner
     * @param {string} id dom id 待用
     * @param {string} type dom type，such as canvas, div etc.
     * @param {Painter} painter painter instance
     */
    function createDom(id, type, painter) {
        var newDom = document.createElement(type);
        var width = painter.getWidth();
        var height = painter.getHeight();

        // 没append呢，请原谅我这样写，清晰~
        newDom.style.position = 'absolute';
        newDom.style.left = 0;
        newDom.style.top = 0;
        newDom.style.width = width + 'px';
        newDom.style.height = height + 'px';
        newDom.width = width * config.devicePixelRatio;
        newDom.height = height * config.devicePixelRatio;

        // id不作为索引用，避免可能造成的重名，定义为私有属性
        newDom.setAttribute('data-zr-dom-id', id);
        return newDom;
    }

    /**
     * @alias module:zrender/Layer
     * @constructor
     * @extends module:zrender/mixin/Transformable
     * @param {string} id
     * @param {module:zrender/Painter} painter
     */
    var Layer = function(id, painter) {

        this.id = id;

        this.dom = createDom(id, 'canvas', painter);
        this.dom.onselectstart = returnFalse; // 避免页面选中的尴尬
        this.dom.style['-webkit-user-select'] = 'none';
        this.dom.style['user-select'] = 'none';
        this.dom.style['-webkit-touch-callout'] = 'none';
        this.dom.style['-webkit-tap-highlight-color'] = 'rgba(0,0,0,0)';

        this.dom.className = config.elementClassName;

        vmlCanvasManager && vmlCanvasManager.initElement(this.dom);

        this.domBack = null;
        this.ctxBack = null;

        this.painter = painter;

        this.unusedCount = 0;

        this.config = null;

        this.dirty = true;

        this.elCount = 0;

        // Configs
        /**
         * 每次清空画布的颜色
         * @type {string}
         * @default 0
         */
        this.clearColor = 0;
        /**
         * 是否开启动态模糊
         * @type {boolean}
         * @default false
         */
        this.motionBlur = false;
        /**
         * 在开启动态模糊的时候使用，与上一帧混合的alpha值，值越大尾迹越明显
         * @type {number}
         * @default 0.7
         */
        this.lastFrameAlpha = 0.7;
        /**
         * 层是否支持鼠标平移操作
         * @type {boolean}
         * @default false
         */
        this.zoomable = false;
        /**
         * 层是否支持鼠标缩放操作
         * @type {boolean}
         * @default false
         */
        this.panable = false;

        this.maxZoom = Infinity;
        this.minZoom = 0;

        Transformable.call(this);
    };

    Layer.prototype.initContext = function () {
        this.ctx = this.dom.getContext('2d');

        var dpr = config.devicePixelRatio;
        if (dpr != 1) { 
            this.ctx.scale(dpr, dpr);
        }
    };

    Layer.prototype.createBackBuffer = function () {
        if (vmlCanvasManager) { // IE 8- should not support back buffer
            return;
        }
        this.domBack = createDom('back-' + this.id, 'canvas', this.painter);
        this.ctxBack = this.domBack.getContext('2d');

        var dpr = config.devicePixelRatio;

        if (dpr != 1) { 
            this.ctxBack.scale(dpr, dpr);
        }
    };

    /**
     * @param  {number} width
     * @param  {number} height
     */
    Layer.prototype.resize = function (width, height) {
        var dpr = config.devicePixelRatio;

        this.dom.style.width = width + 'px';
        this.dom.style.height = height + 'px';

        this.dom.setAttribute('width', width * dpr);
        this.dom.setAttribute('height', height * dpr);

        if (dpr != 1) { 
            this.ctx.scale(dpr, dpr);
        }

        if (this.domBack) {
            this.domBack.setAttribute('width', width * dpr);
            this.domBack.setAttribute('height', height * dpr);

            if (dpr != 1) { 
                this.ctxBack.scale(dpr, dpr);
            }
        }
    };

    /**
     * 清空该层画布
     */
    Layer.prototype.clear = function () {
        var dom = this.dom;
        var ctx = this.ctx;
        var width = dom.width;
        var height = dom.height;

        var haveClearColor = this.clearColor && !vmlCanvasManager;
        var haveMotionBLur = this.motionBlur && !vmlCanvasManager;
        var lastFrameAlpha = this.lastFrameAlpha;
        
        var dpr = config.devicePixelRatio;

        if (haveMotionBLur) {
            if (!this.domBack) {
                this.createBackBuffer();
            } 

            this.ctxBack.globalCompositeOperation = 'copy';
            this.ctxBack.drawImage(
                dom, 0, 0,
                width / dpr,
                height / dpr
            );
        }

        ctx.clearRect(0, 0, width / dpr, height / dpr);
        if (haveClearColor) {
            ctx.save();
            ctx.fillStyle = this.clearColor;
            ctx.fillRect(0, 0, width / dpr, height / dpr);
            ctx.restore();
        }

        if (haveMotionBLur) {
            var domBack = this.domBack;
            ctx.save();
            ctx.globalAlpha = lastFrameAlpha;
            ctx.drawImage(domBack, 0, 0, width / dpr, height / dpr);
            ctx.restore();
        }
    };

    util.merge(Layer.prototype, Transformable.prototype);

    return Layer;
});
define('zrender/shape/Droplet', ['require', './Base', './util/PathProxy', '../tool/area', '../tool/util'], function (require) {
        'use strict';

        var Base = require('./Base');
        var PathProxy = require('./util/PathProxy');
        var area = require('../tool/area');

        /**
         * @alias module:zrender/shape/Droplet
         * @constructor
         * @extends module:zrender/shape/Base
         * @param {Object} options
         */
        var Droplet = function(options) {
            Base.call(this, options);
            this._pathProxy = new PathProxy();
            /**
             * 水滴绘制样式
             * @name module:zrender/shape/Droplet#style
             * @type {module:zrender/shape/Droplet~IDropletStyle}
             */
            /**
             * 水滴高亮绘制样式
             * @name module:zrender/shape/Droplet#highlightStyle
             * @type {module:zrender/shape/Droplet~IDropletStyle}
             */
        };

        Droplet.prototype = {
            type: 'droplet',

            /**
             * 创建水滴路径
             * @param {CanvasRenderingContext2D} ctx
             * @param {module:zrender/shape/Droplet~IDropletStyle} style
             */
            buildPath : function(ctx, style) {
                var path = this._pathProxy || new PathProxy();
                path.begin(ctx);

                path.moveTo(style.x, style.y + style.a);
                path.bezierCurveTo(
                    style.x + style.a,
                    style.y + style.a,
                    style.x + style.a * 3 / 2,
                    style.y - style.a / 3,
                    style.x,
                    style.y - style.b
                );
                path.bezierCurveTo(
                    style.x - style.a * 3 / 2,
                    style.y - style.a / 3,
                    style.x - style.a,
                    style.y + style.a,
                    style.x,
                    style.y + style.a
                );
                path.closePath();
            },

            /**
             * 计算返回水滴的包围盒矩形
             * @param {module:zrender/shape/Droplet~IDropletStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function (style) {
                if (style.__rect) {
                    return style.__rect;
                }
                if (!this._pathProxy.isEmpty()) {
                    this.buildPath(null, style);
                }
                return this._pathProxy.fastBoundingRect();
            },

            isCover: function (x, y) {
                var originPos = this.transformCoordToLocal(x, y);
                x = originPos[0];
                y = originPos[1];
                
                if (this.isCoverRect(x, y)) {
                    return area.isInsidePath(
                        this._pathProxy.pathCommands, this.style.lineWidth, this.style.brushType, x, y
                    );
                }
            }
        };

        require('../tool/util').inherits(Droplet, Base);
        return Droplet;
    });
define('zrender/shape/Star', ['require', '../tool/math', './Base', '../tool/util'], function (require) {

        var math = require('../tool/math');
        var sin = math.sin;
        var cos = math.cos;
        var PI = Math.PI;

        var Base = require('./Base');

        /**
         * @alias module:zrender/shape/Star
         * @param {Object} options
         * @constructor
         * @extends module:zrender/shape/Base
         */
        var Star = function(options) {
            Base.call(this, options);
            /**
             * n角星绘制样式
             * @name module:zrender/shape/Star#style
             * @type {module:zrender/shape/Star~IStarStyle}
             */
            /**
             * n角星高亮绘制样式
             * @name module:zrender/shape/Star#highlightStyle
             * @type {module:zrender/shape/Star~IStarStyle}
             */
        };

        Star.prototype = {
            type: 'star',

            /**
             * 创建n角星（n>3）路径
             * @param {CanvasRenderingContext2D} ctx
             * @param {module:zrender/shape/Star~IStarStyle} style
             */
            buildPath : function(ctx, style) {
                var n = style.n;
                if (!n || n < 2) {
                    return;
                }

                var x = style.x;
                var y = style.y;
                var r = style.r;
                var r0 = style.r0;

                // 如果未指定内部顶点外接圆半径，则自动计算
                if (r0 == null) {
                    r0 = n > 4
                        // 相隔的外部顶点的连线的交点，
                        // 被取为内部交点，以此计算r0
                        ? r * cos(2 * PI / n) / cos(PI / n)
                        // 二三四角星的特殊处理
                        : r / 3;
                }

                var dStep = PI / n;
                var deg = -PI / 2;
                var xStart = x + r * cos(deg);
                var yStart = y + r * sin(deg);
                deg += dStep;

                // 记录边界点，用于判断inside
                var pointList = style.pointList = [];
                pointList.push([ xStart, yStart ]);
                for (var i = 0, end = n * 2 - 1, ri; i < end; i++) {
                    ri = i % 2 === 0 ? r0 : r;
                    pointList.push([ x + ri * cos(deg), y + ri * sin(deg) ]);
                    deg += dStep;
                }
                pointList.push([ xStart, yStart ]);

                // 绘制
                ctx.moveTo(pointList[0][0], pointList[0][1]);
                for (var i = 0; i < pointList.length; i++) {
                    ctx.lineTo(pointList[i][0], pointList[i][1]);
                }
                
                ctx.closePath();

                return;
            },

            /**
             * 返回n角星包围盒矩形
             * @param {module:zrender/shape/Star~IStarStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function(style) {
                if (style.__rect) {
                    return style.__rect;
                }
                
                var lineWidth;
                if (style.brushType == 'stroke' || style.brushType == 'fill') {
                    lineWidth = style.lineWidth || 1;
                }
                else {
                    lineWidth = 0;
                }
                style.__rect = {
                    x : Math.round(style.x - style.r - lineWidth / 2),
                    y : Math.round(style.y - style.r - lineWidth / 2),
                    width : style.r * 2 + lineWidth,
                    height : style.r * 2 + lineWidth
                };
                
                return style.__rect;
            }
        };

        require('../tool/util').inherits(Star, Base);
        return Star;
    });
define('zrender/shape/Heart', ['require', './Base', './util/PathProxy', '../tool/area', '../tool/util'], function (require) {
        'use strict';
        
        var Base = require('./Base');
        var PathProxy = require('./util/PathProxy');
        var area = require('../tool/area');
        
        /**
         * @alias module:zrender/shape/Heart
         * @constructor
         * @extends module:zrender/shape/Base
         * @param {Object} options
         */
        var Heart = function (options) {
            Base.call(this, options);

            this._pathProxy = new PathProxy();
            /**
             * 心形绘制样式
             * @name module:zrender/shape/Heart#style
             * @type {module:zrender/shape/Heart~IHeartStyle}
             */
            /**
             * 心形高亮绘制样式
             * @name module:zrender/shape/Heart#highlightStyle
             * @type {module:zrender/shape/Heart~IHeartStyle}
             */
        };

        Heart.prototype = {
            type: 'heart',

            /**
             * 创建扇形路径
             * @param {CanvasRenderingContext2D} ctx
             * @param {module:zrender/shape/Heart~IHeartStyle} style
             */
            buildPath : function (ctx, style) {
                var path = this._pathProxy || new PathProxy();
                path.begin(ctx);

                path.moveTo(style.x, style.y);
                path.bezierCurveTo(
                    style.x + style.a / 2,
                    style.y - style.b * 2 / 3,
                    style.x + style.a * 2,
                    style.y + style.b / 3,
                    style.x,
                    style.y + style.b
                );
                path.bezierCurveTo(
                    style.x - style.a *  2,
                    style.y + style.b / 3,
                    style.x - style.a / 2,
                    style.y - style.b * 2 / 3,
                    style.x,
                    style.y
                );
                path.closePath();
                return;
            },

            /**
             * 计算返回心形的包围盒矩形
             * @param {module:zrender/shape/Heart~IHeartStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function (style) {
                if (style.__rect) {
                    return style.__rect;
                }
                if (!this._pathProxy.isEmpty()) {
                    this.buildPath(null, style);
                }
                return this._pathProxy.fastBoundingRect();
            },

            isCover: function (x, y) {
                var originPos = this.transformCoordToLocal(x, y);
                x = originPos[0];
                y = originPos[1];
                
                if (this.isCoverRect(x, y)) {
                    return area.isInsidePath(
                        this._pathProxy.pathCommands, this.style.lineWidth, this.style.brushType, x, y
                    );
                }
            }
        };

        require('../tool/util').inherits(Heart, Base);
        return Heart;
    });
define('zrender/shape/util/PathProxy', ['require', '../../tool/vector'], function (require) {
    
    var vector = require('../../tool/vector');
    // var computeBoundingBox = require('../../tool/computeBoundingBox');

    var PathSegment = function(command, points) {
        this.command = command;
        this.points = points || null;
    };

    /**
     * @alias module:zrender/shape/tool/PathProxy
     * @constructor
     */
    var PathProxy = function () {

        /**
         * Path描述的数组，用于`isInsidePath`的判断
         * @type {Array.<Object>}
         */
        this.pathCommands = [];

        this._ctx = null;

        this._min = [];
        this._max = [];
    };

    /**
     * 快速计算Path包围盒（并不是最小包围盒）
     * @return {Object}
     */
    PathProxy.prototype.fastBoundingRect = function () {
        var min = this._min;
        var max = this._max;
        min[0] = min[1] = Infinity;
        max[0] = max[1] = -Infinity;
        for (var i = 0; i < this.pathCommands.length; i++) {
            var seg = this.pathCommands[i];
            var p = seg.points;
            switch (seg.command) {
                case 'M':
                    vector.min(min, min, p);
                    vector.max(max, max, p);
                    break;
                case 'L':
                    vector.min(min, min, p);
                    vector.max(max, max, p);
                    break;
                case 'C':
                    for (var j = 0; j < 6; j += 2) {
                        min[0] = Math.min(min[0], min[0], p[j]);
                        min[1] = Math.min(min[1], min[1], p[j + 1]);
                        max[0] = Math.max(max[0], max[0], p[j]);
                        max[1] = Math.max(max[1], max[1], p[j + 1]);
                    }
                    break;
                case 'Q':
                    for (var j = 0; j < 4; j += 2) {
                        min[0] = Math.min(min[0], min[0], p[j]);
                        min[1] = Math.min(min[1], min[1], p[j + 1]);
                        max[0] = Math.max(max[0], max[0], p[j]);
                        max[1] = Math.max(max[1], max[1], p[j + 1]);
                    }
                    break;
                case 'A':
                    var cx = p[0];
                    var cy = p[1];
                    var rx = p[2];
                    var ry = p[3];
                    min[0] = Math.min(min[0], min[0], cx - rx);
                    min[1] = Math.min(min[1], min[1], cy - ry);
                    max[0] = Math.max(max[0], max[0], cx + rx);
                    max[1] = Math.max(max[1], max[1], cy + ry);
                    break;
            }
        }

        return {
            x: min[0],
            y: min[1],
            width: max[0] - min[0],
            height: max[1] - min[1]
        };
    };

    /**
     * @param  {CanvasRenderingContext2D} ctx
     * @return {module:zrender/shape/util/PathProxy}
     */
    PathProxy.prototype.begin = function (ctx) {
        this._ctx = ctx || null;
        // 清空pathCommands
        this.pathCommands.length = 0;

        return this;
    };

    /**
     * @param  {number} x
     * @param  {number} y
     * @return {module:zrender/shape/util/PathProxy}
     */
    PathProxy.prototype.moveTo = function (x, y) {
        this.pathCommands.push(new PathSegment('M', [x, y]));
        if (this._ctx) {
            this._ctx.moveTo(x, y);
        }
        return this;
    };

    /**
     * @param  {number} x
     * @param  {number} y
     * @return {module:zrender/shape/util/PathProxy}
     */
    PathProxy.prototype.lineTo = function (x, y) {
        this.pathCommands.push(new PathSegment('L', [x, y]));
        if (this._ctx) {
            this._ctx.lineTo(x, y);
        }
        return this;
    };

    /**
     * @param  {number} x1
     * @param  {number} y1
     * @param  {number} x2
     * @param  {number} y2
     * @param  {number} x3
     * @param  {number} y3
     * @return {module:zrender/shape/util/PathProxy}
     */
    PathProxy.prototype.bezierCurveTo = function (x1, y1, x2, y2, x3, y3) {
        this.pathCommands.push(new PathSegment('C', [x1, y1, x2, y2, x3, y3]));
        if (this._ctx) {
            this._ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
        }
        return this;
    };

    /**
     * @param  {number} x1
     * @param  {number} y1
     * @param  {number} x2
     * @param  {number} y2
     * @return {module:zrender/shape/util/PathProxy}
     */
    PathProxy.prototype.quadraticCurveTo = function (x1, y1, x2, y2) {
        this.pathCommands.push(new PathSegment('Q', [x1, y1, x2, y2]));
        if (this._ctx) {
            this._ctx.quadraticCurveTo(x1, y1, x2, y2);
        }
        return this;
    };

    /**
     * @param  {number} cx
     * @param  {number} cy
     * @param  {number} r
     * @param  {number} startAngle
     * @param  {number} endAngle
     * @param  {boolean} anticlockwise
     * @return {module:zrender/shape/util/PathProxy}
     */
    PathProxy.prototype.arc = function (cx, cy, r, startAngle, endAngle, anticlockwise) {
        this.pathCommands.push(new PathSegment(
            'A', [cx, cy, r, r, startAngle, endAngle - startAngle, 0, anticlockwise ? 0 : 1]
        ));
        if (this._ctx) {
            this._ctx.arc(cx, cy, r, startAngle, endAngle, anticlockwise);
        }
        return this;
    };

    // TODO
    PathProxy.prototype.arcTo = function (x1, y1, x2, y2, radius) {
        if (this._ctx) {
            this._ctx.arcTo(x1, y1, x2, y2, radius);
        }
        return this;
    };

    // TODO
    PathProxy.prototype.rect = function (x, y, w, h) {
        if (this._ctx) {
            this._ctx.rect(x, y, w, h);
        }
        return this;
    };

    /**
     * @return {module:zrender/shape/util/PathProxy}
     */
    PathProxy.prototype.closePath = function () {
        this.pathCommands.push(new PathSegment('z'));
        if (this._ctx) {
            this._ctx.closePath();
        }
        return this;
    };

    /**
     * 是否没有Path命令
     * @return {boolean}
     */
    PathProxy.prototype.isEmpty = function() {
        return this.pathCommands.length === 0;
    };

    PathProxy.PathSegment = PathSegment;

    return PathProxy;
});
define('zrender/shape/Line', ['require', './Base', './util/dashedLineTo', '../tool/util'], function (require) {
        var Base = require('./Base');
        var dashedLineTo = require('./util/dashedLineTo');
        
        /**
         * @alias module:zrender/shape/Line
         * @param {Object} options
         * @constructor
         * @extends module:zrender/shape/Base
         */
        var Line = function (options) {
            this.brushTypeOnly = 'stroke';  // 线条只能描边，填充后果自负
            this.textPosition = 'end';
            Base.call(this, options);

            /**
             * 直线绘制样式
             * @name module:zrender/shape/Line#style
             * @type {module:zrender/shape/Line~ILineStyle}
             */
            /**
             * 直线高亮绘制样式
             * @name module:zrender/shape/Line#highlightStyle
             * @type {module:zrender/shape/Line~ILineStyle}
             */
        };

        Line.prototype =  {
            type: 'line',

            /**
             * 创建线条路径
             * @param {CanvasRenderingContext2D} ctx
             * @param {module:zrender/shape/Line~ILineStyle} style
             */
            buildPath : function (ctx, style) {
                if (!style.lineType || style.lineType == 'solid') {
                    // 默认为实线
                    ctx.moveTo(style.xStart, style.yStart);
                    ctx.lineTo(style.xEnd, style.yEnd);
                }
                else if (style.lineType == 'dashed'
                        || style.lineType == 'dotted'
                ) {
                    var dashLength = (style.lineWidth || 1)  
                                     * (style.lineType == 'dashed' ? 5 : 1);
                    dashedLineTo(
                        ctx,
                        style.xStart, style.yStart,
                        style.xEnd, style.yEnd,
                        dashLength
                    );
                }
            },

            /**
             * 计算返回线条的包围盒矩形
             * @param {module:zrender/shape/Line~ILineStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function (style) {
                if (style.__rect) {
                    return style.__rect;
                }
                
                var lineWidth = style.lineWidth || 1;
                style.__rect = {
                    x : Math.min(style.xStart, style.xEnd) - lineWidth,
                    y : Math.min(style.yStart, style.yEnd) - lineWidth,
                    width : Math.abs(style.xStart - style.xEnd)
                            + lineWidth,
                    height : Math.abs(style.yStart - style.yEnd)
                             + lineWidth
                };
                
                return style.__rect;
            }
        };

        require('../tool/util').inherits(Line, Base);
        return Line;
    });
define('zrender/shape/BezierCurve', ['require', './Base', '../tool/util'], function (require) {
        'use strict';

        var Base = require('./Base');
        
        /**
         * @alias module:zrender/shape/BezierCurve
         * @constructor
         * @extends module:zrender/shape/Base
         * @param {Object} options
         */
        var BezierCurve = function(options) {
            this.brushTypeOnly = 'stroke';  // 线条只能描边，填充后果自负
            this.textPosition = 'end';
            Base.call(this, options);
            /**
             * 贝赛尔曲线绘制样式
             * @name module:zrender/shape/BezierCurve#style
             * @type {module:zrender/shape/BezierCurve~IBezierCurveStyle}
             */
            /**
             * 贝赛尔曲线高亮绘制样式
             * @name module:zrender/shape/BezierCurve#highlightStyle
             * @type {module:zrender/shape/BezierCurve~IBezierCurveStyle}
             */
        };

        BezierCurve.prototype = {
            type: 'bezier-curve',

            /**
             * 创建贝塞尔曲线路径
             * @param {CanvasRenderingContext2D} ctx
             * @param {module:zrender/shape/BezierCurve~IBezierCurveStyle} style
             */
            buildPath : function(ctx, style) {
                ctx.moveTo(style.xStart, style.yStart);
                if (typeof style.cpX2 != 'undefined'
                    && typeof style.cpY2 != 'undefined'
                ) {
                    ctx.bezierCurveTo(
                        style.cpX1, style.cpY1,
                        style.cpX2, style.cpY2,
                        style.xEnd, style.yEnd
                    );
                }
                else {
                    ctx.quadraticCurveTo(
                        style.cpX1, style.cpY1,
                        style.xEnd, style.yEnd
                    );
                }
            },

            /**
             * 计算返回贝赛尔曲线包围盒矩形。
             * 该包围盒是直接从四个控制点计算，并非最小包围盒。
             * @param {module:zrender/shape/BezierCurve~IBezierCurveStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function(style) {
                if (style.__rect) {
                    return style.__rect;
                }
                
                var _minX = Math.min(style.xStart, style.xEnd, style.cpX1);
                var _minY = Math.min(style.yStart, style.yEnd, style.cpY1);
                var _maxX = Math.max(style.xStart, style.xEnd, style.cpX1);
                var _maxY = Math.max(style.yStart, style.yEnd, style.cpY1);
                var _x2 = style.cpX2;
                var _y2 = style.cpY2;

                if (typeof _x2 != 'undefined'
                    && typeof _y2 != 'undefined'
                ) {
                    _minX = Math.min(_minX, _x2);
                    _minY = Math.min(_minY, _y2);
                    _maxX = Math.max(_maxX, _x2);
                    _maxY = Math.max(_maxY, _y2);
                }

                var lineWidth = style.lineWidth || 1;
                style.__rect = {
                    x : _minX - lineWidth,
                    y : _minY - lineWidth,
                    width : _maxX - _minX + lineWidth,
                    height : _maxY - _minY + lineWidth
                };
                
                return style.__rect;
            }
        };

        require('../tool/util').inherits(BezierCurve, Base);
        return BezierCurve;
    });
define('zrender/shape/util/dashedLineTo', [], function (/* require */) {

        var dashPattern = [ 5, 5 ];
        /**
         * 虚线lineTo 
         */
        return function (ctx, x1, y1, x2, y2, dashLength) {
            // http://msdn.microsoft.com/en-us/library/ie/dn265063(v=vs.85).aspx
            if (ctx.setLineDash) {
                dashPattern[0] = dashPattern[1] = dashLength;
                ctx.setLineDash(dashPattern);
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                return;
            }

            dashLength = typeof dashLength != 'number'
                            ? 5 
                            : dashLength;

            var dx = x2 - x1;
            var dy = y2 - y1;
            var numDashes = Math.floor(
                Math.sqrt(dx * dx + dy * dy) / dashLength
            );
            dx = dx / numDashes;
            dy = dy / numDashes;
            var flag = true;
            for (var i = 0; i < numDashes; ++i) {
                if (flag) {
                    ctx.moveTo(x1, y1);
                }
                else {
                    ctx.lineTo(x1, y1);
                }
                flag = !flag;
                x1 += dx;
                y1 += dy;
            }
            ctx.lineTo(x2, y2);
        };
    });
define('zrender/Group', ['require', './tool/guid', './tool/util', './mixin/Transformable', './mixin/Eventful'], function (require) {

    var guid = require('./tool/guid');
    var util = require('./tool/util');

    var Transformable = require('./mixin/Transformable');
    var Eventful = require('./mixin/Eventful');

    /**
     * @alias module:zrender/Group
     * @constructor
     * @extends module:zrender/mixin/Transformable
     * @extends module:zrender/mixin/Eventful
     */
    var Group = function(options) {

        options = options || {};

        /**
         * Group id
         * @type {string}
         */
        this.id = options.id || guid();

        for (var key in options) {
            this[key] = options[key];
        }

        /**
         * @type {string}
         */
        this.type = 'group';

        /**
         * 用于裁剪的图形(shape)，所有 Group 内的图形在绘制时都会被这个图形裁剪
         * 该图形会继承Group的变换
         * @type {module:zrender/shape/Base}
         * @see http://www.w3.org/TR/2dcontext/#clipping-region
         */
        this.clipShape = null;

        this._children = [];

        this._storage = null;

        this.__dirty = true;

        // Mixin
        Transformable.call(this);
        Eventful.call(this);
    };

    /**
     * 是否忽略该 Group 及其所有子节点
     * @type {boolean}
     * @default false
     */
    Group.prototype.ignore = false;

    /**
     * 复制并返回一份新的包含所有儿子节点的数组
     * @return {Array.<module:zrender/Group|module:zrender/shape/Base>}
     */
    Group.prototype.children = function() {
        return this._children.slice();
    };

    /**
     * 获取指定 index 的儿子节点
     * @param  {number} idx
     * @return {module:zrender/Group|module:zrender/shape/Base}
     */
    Group.prototype.childAt = function(idx) {
        return this._children[idx];
    };

    /**
     * 添加子节点，可以是Shape或者Group
     * @param {module:zrender/Group|module:zrender/shape/Base} child
     */
    // TODO Type Check
    Group.prototype.addChild = function(child) {
        if (child == this) {
            return;
        }
        
        if (child.parent == this) {
            return;
        }
        if (child.parent) {
            child.parent.removeChild(child);
        }

        this._children.push(child);
        child.parent = this;

        if (this._storage && this._storage !== child._storage) {
            
            this._storage.addToMap(child);

            if (child instanceof Group) {
                child.addChildrenToStorage(this._storage);
            }
        }
    };

    /**
     * 移除子节点
     * @param {module:zrender/Group|module:zrender/shape/Base} child
     */
    // TODO Type Check
    Group.prototype.removeChild = function(child) {
        var idx = util.indexOf(this._children, child);

        if (idx >= 0) {
            this._children.splice(idx, 1);
        }
        child.parent = null;

        if (this._storage) {
            
            this._storage.delFromMap(child.id);

            if (child instanceof Group) {
                child.delChildrenFromStorage(this._storage);
            }
        }
    };

    /**
     * 移除所有子节点
     */
    Group.prototype.clearChildren = function () {
        for (var i = 0; i < this._children.length; i++) {
            var child = this._children[i];
            if (this._storage) {
                this._storage.delFromMap(child.id);
                if (child instanceof Group) {
                    child.delChildrenFromStorage(this._storage);
                }
            }
        }
        this._children.length = 0;
    };

    /**
     * 遍历所有子节点
     * @param  {Function} cb
     * @param  {}   context
     */
    Group.prototype.eachChild = function(cb, context) {
        var haveContext = !!context;
        for (var i = 0; i < this._children.length; i++) {
            var child = this._children[i];
            if (haveContext) {
                cb.call(context, child);
            } else {
                cb(child);
            }
        }
    };

    /**
     * 深度优先遍历所有子孙节点
     * @param  {Function} cb
     * @param  {}   context
     */
    Group.prototype.traverse = function(cb, context) {
        var haveContext = !!context;
        for (var i = 0; i < this._children.length; i++) {
            var child = this._children[i];
            if (haveContext) {
                cb.call(context, child);
            } else {
                cb(child);
            }

            if (child.type === 'group') {
                child.traverse(cb, context);
            }
        }
    };

    Group.prototype.addChildrenToStorage = function(storage) {
        for (var i = 0; i < this._children.length; i++) {
            var child = this._children[i];
            storage.addToMap(child);
            if (child instanceof Group) {
                child.addChildrenToStorage(storage);
            }
        }
    };

    Group.prototype.delChildrenFromStorage = function(storage) {
        for (var i = 0; i < this._children.length; i++) {
            var child = this._children[i];
            storage.delFromMap(child.id);
            if (child instanceof Group) {
                child.delChildrenFromStorage(storage);
            }
        }
    };

    Group.prototype.modSelf = function() {
        this.__dirty = true;
    };

    util.merge(Group.prototype, Transformable.prototype, true);
    util.merge(Group.prototype, Eventful.prototype, true);

    return Group;
});
define('echarts/util/shape/normalIsCover', [], function () {
    return function (x, y) {
        var originPos = this.transformCoordToLocal(x, y);
        x = originPos[0];
        y = originPos[1];

        return this.isCoverRect(x, y);
    };
});
define('zrender/shape/Polygon', ['require', './Base', './util/smoothSpline', './util/smoothBezier', './util/dashedLineTo', '../tool/util'], function (require) {
        var Base = require('./Base');
        var smoothSpline = require('./util/smoothSpline');
        var smoothBezier = require('./util/smoothBezier');
        var dashedLineTo = require('./util/dashedLineTo');

        /**
         * @alias module:zrender/shape/Polygon
         * @param {Object} options
         * @constructor
         * @extends module:zrender/shape/Base
         */
        var Polygon = function (options) {
            Base.call(this, options);
            /**
             * 多边形绘制样式
             * @name module:zrender/shape/Polygon#style
             * @type {module:zrender/shape/Polygon~IPolygonStyle}
             */
            /**
             * 多边形高亮绘制样式
             * @name module:zrender/shape/Polygon#highlightStyle
             * @type {module:zrender/shape/Polygon~IPolygonStyle}
             */
        };

        Polygon.prototype = {
            type: 'polygon',

            /**
             * 创建多边形路径
             * @param {CanvasRenderingContext2D} ctx
             * @param {module:zrender/shape/Polygon~IPolygonStyle} style
             */
            buildPath : function (ctx, style) {
                // 虽然能重用brokenLine，但底层图形基于性能考虑，重复代码减少调用吧
                var pointList = style.pointList;
                // 开始点和结束点重复
                /*
                var start = pointList[0];
                var end = pointList[pointList.length-1];

                if (start && end) {
                    if (start[0] == end[0] &&
                        start[1] == end[1]) {
                        // 移除最后一个点
                        pointList.pop();
                    }
                }
                */

                if (pointList.length < 2) {
                    // 少于2个点就不画了~
                    return;
                }

                if (style.smooth && style.smooth !== 'spline') {
                    var controlPoints = smoothBezier(
                        pointList, style.smooth, true, style.smoothConstraint
                    );

                    ctx.moveTo(pointList[0][0], pointList[0][1]);
                    var cp1;
                    var cp2;
                    var p;
                    var len = pointList.length;
                    for (var i = 0; i < len; i++) {
                        cp1 = controlPoints[i * 2];
                        cp2 = controlPoints[i * 2 + 1];
                        p = pointList[(i + 1) % len];
                        ctx.bezierCurveTo(
                            cp1[0], cp1[1], cp2[0], cp2[1], p[0], p[1]
                        );
                    }
                } 
                else {
                    if (style.smooth === 'spline') {
                        pointList = smoothSpline(pointList, true);
                    }

                    if (!style.lineType || style.lineType == 'solid') {
                        // 默认为实线
                        ctx.moveTo(pointList[0][0], pointList[0][1]);
                        for (var i = 1, l = pointList.length; i < l; i++) {
                            ctx.lineTo(pointList[i][0], pointList[i][1]);
                        }
                        ctx.lineTo(pointList[0][0], pointList[0][1]);
                    }
                    else if (style.lineType == 'dashed'
                            || style.lineType == 'dotted'
                    ) {
                        var dashLength = 
                            style._dashLength
                            || (style.lineWidth || 1) 
                               * (style.lineType == 'dashed' ? 5 : 1);
                        style._dashLength = dashLength;
                        ctx.moveTo(pointList[0][0], pointList[0][1]);
                        for (var i = 1, l = pointList.length; i < l; i++) {
                            dashedLineTo(
                                ctx,
                                pointList[i - 1][0], pointList[i - 1][1],
                                pointList[i][0], pointList[i][1],
                                dashLength
                            );
                        }
                        dashedLineTo(
                            ctx,
                            pointList[pointList.length - 1][0], 
                            pointList[pointList.length - 1][1],
                            pointList[0][0],
                            pointList[0][1],
                            dashLength
                        );
                    }
                }

                ctx.closePath();
                return;
            },

            /**
             * 计算返回多边形包围盒矩阵
             * @param {module:zrender/shape/Polygon~IPolygonStyle} style
             * @return {module:zrender/shape/Base~IBoundingRect}
             */
            getRect : function (style) {
                if (style.__rect) {
                    return style.__rect;
                }
                
                var minX =  Number.MAX_VALUE;
                var maxX =  Number.MIN_VALUE;
                var minY = Number.MAX_VALUE;
                var maxY = Number.MIN_VALUE;

                var pointList = style.pointList;
                for (var i = 0, l = pointList.length; i < l; i++) {
                    if (pointList[i][0] < minX) {
                        minX = pointList[i][0];
                    }
                    if (pointList[i][0] > maxX) {
                        maxX = pointList[i][0];
                    }
                    if (pointList[i][1] < minY) {
                        minY = pointList[i][1];
                    }
                    if (pointList[i][1] > maxY) {
                        maxY = pointList[i][1];
                    }
                }

                var lineWidth;
                if (style.brushType == 'stroke' || style.brushType == 'fill') {
                    lineWidth = style.lineWidth || 1;
                }
                else {
                    lineWidth = 0;
                }
                
                style.__rect = {
                    x : Math.round(minX - lineWidth / 2),
                    y : Math.round(minY - lineWidth / 2),
                    width : maxX - minX + lineWidth,
                    height : maxY - minY + lineWidth
                };
                return style.__rect;
            }
        };

        require('../tool/util').inherits(Polygon, Base);
        return Polygon;
    });
define('zrender/animation/Clip', ['require', './easing'], function (require) {

        var Easing = require('./easing');

        function Clip(options) {

            this._targetPool = options.target || {};
            if (!(this._targetPool instanceof Array)) {
                this._targetPool = [ this._targetPool ];
            }

            // 生命周期
            this._life = options.life || 1000;
            // 延时
            this._delay = options.delay || 0;
            // 开始时间
            this._startTime = new Date().getTime() + this._delay;// 单位毫秒

            // 结束时间
            this._endTime = this._startTime + this._life * 1000;

            // 是否循环
            this.loop = typeof options.loop == 'undefined'
                        ? false : options.loop;

            this.gap = options.gap || 0;

            this.easing = options.easing || 'Linear';

            this.onframe = options.onframe;
            this.ondestroy = options.ondestroy;
            this.onrestart = options.onrestart;
        }

        Clip.prototype = {
            step : function (time) {
                var percent = (time - this._startTime) / this._life;

                // 还没开始
                if (percent < 0) {
                    return;
                }

                percent = Math.min(percent, 1);

                var easingFunc = typeof this.easing == 'string'
                                 ? Easing[this.easing]
                                 : this.easing;
                var schedule = typeof easingFunc === 'function'
                    ? easingFunc(percent)
                    : percent;

                this.fire('frame', schedule);

                // 结束
                if (percent == 1) {
                    if (this.loop) {
                        this.restart();
                        // 重新开始周期
                        // 抛出而不是直接调用事件直到 stage.update 后再统一调用这些事件
                        return 'restart';
                    }
                    
                    // 动画完成将这个控制器标识为待删除
                    // 在Animation.update中进行批量删除
                    this._needsRemove = true;
                    return 'destroy';
                }
                
                return null;
            },
            restart : function() {
                var time = new Date().getTime();
                var remainder = (time - this._startTime) % this._life;
                this._startTime = new Date().getTime() - remainder + this.gap;

                this._needsRemove = false;
            },
            fire : function(eventType, arg) {
                for (var i = 0, len = this._targetPool.length; i < len; i++) {
                    if (this['on' + eventType]) {
                        this['on' + eventType](this._targetPool[i], arg);
                    }
                }
            },
            constructor: Clip
        };

        return Clip;
    });
define('zrender/shape/util/smoothBezier', ['require', '../../tool/vector'], function (require) {
        var vector = require('../../tool/vector');

        /**
         * 贝塞尔平滑曲线
         * @alias module:zrender/shape/util/smoothBezier
         * @param {Array} points 线段顶点数组
         * @param {number} smooth 平滑等级, 0-1
         * @param {boolean} isLoop
         * @param {Array} constraint 将计算出来的控制点约束在一个包围盒内
         *                           比如 [[0, 0], [100, 100]], 这个包围盒会与
         *                           整个折线的包围盒做一个并集用来约束控制点。
         * @param {Array} 计算出来的控制点数组
         */
        return function (points, smooth, isLoop, constraint) {
            var cps = [];

            var v = [];
            var v1 = [];
            var v2 = [];
            var prevPoint;
            var nextPoint;

            var hasConstraint = !!constraint;
            var min, max;
            if (hasConstraint) {
                min = [Infinity, Infinity];
                max = [-Infinity, -Infinity];
                for (var i = 0, len = points.length; i < len; i++) {
                    vector.min(min, min, points[i]);
                    vector.max(max, max, points[i]);
                }
                // 与指定的包围盒做并集
                vector.min(min, min, constraint[0]);
                vector.max(max, max, constraint[1]);
            }

            for (var i = 0, len = points.length; i < len; i++) {
                var point = points[i];
                var prevPoint;
                var nextPoint;

                if (isLoop) {
                    prevPoint = points[i ? i - 1 : len - 1];
                    nextPoint = points[(i + 1) % len];
                } 
                else {
                    if (i === 0 || i === len - 1) {
                        cps.push(vector.clone(points[i]));
                        continue;
                    } 
                    else {
                        prevPoint = points[i - 1];
                        nextPoint = points[i + 1];
                    }
                }

                vector.sub(v, nextPoint, prevPoint);

                // use degree to scale the handle length
                vector.scale(v, v, smooth);

                var d0 = vector.distance(point, prevPoint);
                var d1 = vector.distance(point, nextPoint);
                var sum = d0 + d1;
                if (sum !== 0) {
                    d0 /= sum;
                    d1 /= sum;
                }

                vector.scale(v1, v, -d0);
                vector.scale(v2, v, d1);
                var cp0 = vector.add([], point, v1);
                var cp1 = vector.add([], point, v2);
                if (hasConstraint) {
                    vector.max(cp0, cp0, min);
                    vector.min(cp0, cp0, max);
                    vector.max(cp1, cp1, min);
                    vector.min(cp1, cp1, max);
                }
                cps.push(cp0);
                cps.push(cp1);
            }
            
            if (isLoop) {
                cps.push(vector.clone(cps.shift()));
            }

            return cps;
        };
    });
define('zrender/shape/util/smoothSpline', ['require', '../../tool/vector'], function (require) {
        var vector = require('../../tool/vector');

        /**
         * @inner
         */
        function interpolate(p0, p1, p2, p3, t, t2, t3) {
            var v0 = (p2 - p0) * 0.5;
            var v1 = (p3 - p1) * 0.5;
            return (2 * (p1 - p2) + v0 + v1) * t3 
                    + (-3 * (p1 - p2) - 2 * v0 - v1) * t2
                    + v0 * t + p1;
        }

        /**
         * @alias module:zrender/shape/util/smoothSpline
         * @param {Array} points 线段顶点数组
         * @param {boolean} isLoop
         * @param {Array} constraint 
         * @return {Array}
         */
        return function (points, isLoop, constraint) {
            var len = points.length;
            var ret = [];

            var distance = 0;
            for (var i = 1; i < len; i++) {
                distance += vector.distance(points[i - 1], points[i]);
            }
            
            var segs = distance / 5;
            segs = segs < len ? len : segs;
            for (var i = 0; i < segs; i++) {
                var pos = i / (segs - 1) * (isLoop ? len : len - 1);
                var idx = Math.floor(pos);

                var w = pos - idx;

                var p0;
                var p1 = points[idx % len];
                var p2;
                var p3;
                if (!isLoop) {
                    p0 = points[idx === 0 ? idx : idx - 1];
                    p2 = points[idx > len - 2 ? len - 1 : idx + 1];
                    p3 = points[idx > len - 3 ? len - 1 : idx + 2];
                }
                else {
                    p0 = points[(idx - 1 + len) % len];
                    p2 = points[(idx + 1) % len];
                    p3 = points[(idx + 2) % len];
                }

                var w2 = w * w;
                var w3 = w * w2;

                ret.push([
                    interpolate(p0[0], p1[0], p2[0], p3[0], w, w2, w3),
                    interpolate(p0[1], p1[1], p2[1], p3[1], w, w2, w3)
                ]);
            }
            return ret;
        };
    });
define('zrender/animation/easing', [], function () {
        /**
         * 缓动代码来自 https://github.com/sole/tween.js/blob/master/src/Tween.js
         * @see http://sole.github.io/tween.js/examples/03_graphs.html
         * @exports zrender/animation/easing
         */
        var easing = {
            // 线性
            /**
             * @param {number} k
             * @return {number}
             */
            Linear: function (k) {
                return k;
            },

            // 二次方的缓动（t^2）
            /**
             * @param {number} k
             * @return {number}
             */
            QuadraticIn: function (k) {
                return k * k;
            },
            /**
             * @param {number} k
             * @return {number}
             */
            QuadraticOut: function (k) {
                return k * (2 - k);
            },
            /**
             * @param {number} k
             * @return {number}
             */
            QuadraticInOut: function (k) {
                if ((k *= 2) < 1) {
                    return 0.5 * k * k;
                }
                return -0.5 * (--k * (k - 2) - 1);
            },

            // 三次方的缓动（t^3）
            /**
             * @param {number} k
             * @return {number}
             */
            CubicIn: function (k) {
                return k * k * k;
            },
            /**
             * @param {number} k
             * @return {number}
             */
            CubicOut: function (k) {
                return --k * k * k + 1;
            },
            /**
             * @param {number} k
             * @return {number}
             */
            CubicInOut: function (k) {
                if ((k *= 2) < 1) {
                    return 0.5 * k * k * k;
                }
                return 0.5 * ((k -= 2) * k * k + 2);
            },

            // 四次方的缓动（t^4）
            /**
             * @param {number} k
             * @return {number}
             */
            QuarticIn: function (k) {
                return k * k * k * k;
            },
            /**
             * @param {number} k
             * @return {number}
             */
            QuarticOut: function (k) {
                return 1 - (--k * k * k * k);
            },
            /**
             * @param {number} k
             * @return {number}
             */
            QuarticInOut: function (k) {
                if ((k *= 2) < 1) {
                    return 0.5 * k * k * k * k;
                }
                return -0.5 * ((k -= 2) * k * k * k - 2);
            },

            // 五次方的缓动（t^5）
            /**
             * @param {number} k
             * @return {number}
             */
            QuinticIn: function (k) {
                return k * k * k * k * k;
            },
            /**
             * @param {number} k
             * @return {number}
             */
            QuinticOut: function (k) {
                return --k * k * k * k * k + 1;
            },
            /**
             * @param {number} k
             * @return {number}
             */
            QuinticInOut: function (k) {
                if ((k *= 2) < 1) {
                    return 0.5 * k * k * k * k * k;
                }
                return 0.5 * ((k -= 2) * k * k * k * k + 2);
            },

            // 正弦曲线的缓动（sin(t)）
            /**
             * @param {number} k
             * @return {number}
             */
            SinusoidalIn: function (k) {
                return 1 - Math.cos(k * Math.PI / 2);
            },
            /**
             * @param {number} k
             * @return {number}
             */
            SinusoidalOut: function (k) {
                return Math.sin(k * Math.PI / 2);
            },
            /**
             * @param {number} k
             * @return {number}
             */
            SinusoidalInOut: function (k) {
                return 0.5 * (1 - Math.cos(Math.PI * k));
            },

            // 指数曲线的缓动（2^t）
            /**
             * @param {number} k
             * @return {number}
             */
            ExponentialIn: function (k) {
                return k === 0 ? 0 : Math.pow(1024, k - 1);
            },
            /**
             * @param {number} k
             * @return {number}
             */
            ExponentialOut: function (k) {
                return k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
            },
            /**
             * @param {number} k
             * @return {number}
             */
            ExponentialInOut: function (k) {
                if (k === 0) {
                    return 0;
                }
                if (k === 1) {
                    return 1;
                }
                if ((k *= 2) < 1) {
                    return 0.5 * Math.pow(1024, k - 1);
                }
                return 0.5 * (-Math.pow(2, -10 * (k - 1)) + 2);
            },

            // 圆形曲线的缓动（sqrt(1-t^2)）
            /**
             * @param {number} k
             * @return {number}
             */
            CircularIn: function (k) {
                return 1 - Math.sqrt(1 - k * k);
            },
            /**
             * @param {number} k
             * @return {number}
             */
            CircularOut: function (k) {
                return Math.sqrt(1 - (--k * k));
            },
            /**
             * @param {number} k
             * @return {number}
             */
            CircularInOut: function (k) {
                if ((k *= 2) < 1) {
                    return -0.5 * (Math.sqrt(1 - k * k) - 1);
                }
                return 0.5 * (Math.sqrt(1 - (k -= 2) * k) + 1);
            },

            // 创建类似于弹簧在停止前来回振荡的动画
            /**
             * @param {number} k
             * @return {number}
             */
            ElasticIn: function (k) {
                var s; 
                var a = 0.1;
                var p = 0.4;
                if (k === 0) {
                    return 0;
                }
                if (k === 1) {
                    return 1;
                }
                if (!a || a < 1) {
                    a = 1; s = p / 4;
                }
                else {
                    s = p * Math.asin(1 / a) / (2 * Math.PI);
                }
                return -(a * Math.pow(2, 10 * (k -= 1)) *
                            Math.sin((k - s) * (2 * Math.PI) / p));
            },
            /**
             * @param {number} k
             * @return {number}
             */
            ElasticOut: function (k) {
                var s;
                var a = 0.1;
                var p = 0.4;
                if (k === 0) {
                    return 0;
                }
                if (k === 1) {
                    return 1;
                }
                if (!a || a < 1) {
                    a = 1; s = p / 4;
                }
                else {
                    s = p * Math.asin(1 / a) / (2 * Math.PI);
                }
                return (a * Math.pow(2, -10 * k) *
                        Math.sin((k - s) * (2 * Math.PI) / p) + 1);
            },
            /**
             * @param {number} k
             * @return {number}
             */
            ElasticInOut: function (k) {
                var s;
                var a = 0.1;
                var p = 0.4;
                if (k === 0) {
                    return 0;
                }
                if (k === 1) {
                    return 1;
                }
                if (!a || a < 1) {
                    a = 1; s = p / 4;
                }
                else {
                    s = p * Math.asin(1 / a) / (2 * Math.PI);
                }
                if ((k *= 2) < 1) {
                    return -0.5 * (a * Math.pow(2, 10 * (k -= 1))
                        * Math.sin((k - s) * (2 * Math.PI) / p));
                }
                return a * Math.pow(2, -10 * (k -= 1))
                        * Math.sin((k - s) * (2 * Math.PI) / p) * 0.5 + 1;

            },

            // 在某一动画开始沿指示的路径进行动画处理前稍稍收回该动画的移动
            /**
             * @param {number} k
             * @return {number}
             */
            BackIn: function (k) {
                var s = 1.70158;
                return k * k * ((s + 1) * k - s);
            },
            /**
             * @param {number} k
             * @return {number}
             */
            BackOut: function (k) {
                var s = 1.70158;
                return --k * k * ((s + 1) * k + s) + 1;
            },
            /**
             * @param {number} k
             * @return {number}
             */
            BackInOut: function (k) {
                var s = 1.70158 * 1.525;
                if ((k *= 2) < 1) {
                    return 0.5 * (k * k * ((s + 1) * k - s));
                }
                return 0.5 * ((k -= 2) * k * ((s + 1) * k + s) + 2);
            },

            // 创建弹跳效果
            /**
             * @param {number} k
             * @return {number}
             */
            BounceIn: function (k) {
                return 1 - easing.BounceOut(1 - k);
            },
            /**
             * @param {number} k
             * @return {number}
             */
            BounceOut: function (k) {
                if (k < (1 / 2.75)) {
                    return 7.5625 * k * k;
                }
                else if (k < (2 / 2.75)) {
                    return 7.5625 * (k -= (1.5 / 2.75)) * k + 0.75;
                }
                else if (k < (2.5 / 2.75)) {
                    return 7.5625 * (k -= (2.25 / 2.75)) * k + 0.9375;
                }
                else {
                    return 7.5625 * (k -= (2.625 / 2.75)) * k + 0.984375;
                }
            },
            /**
             * @param {number} k
             * @return {number}
             */
            BounceInOut: function (k) {
                if (k < 0.5) {
                    return easing.BounceIn(k * 2) * 0.5;
                }
                return easing.BounceOut(k * 2 - 1) * 0.5 + 0.5;
            }
        };

        return easing;
    });
define('echarts/util/ecQuery', ['require', 'zrender/tool/util'], function (require) {
    var zrUtil = require('zrender/tool/util');
    
    /**
     * 获取嵌套选项的基础方法
     * 返回optionTarget中位于optionLocation上的值，如果没有定义，则返回undefined
     */
    function query(optionTarget, optionLocation) {
        if (typeof optionTarget == 'undefined') {
            return;
        }

        if (!optionLocation) {
            return optionTarget;
        }

        optionLocation = optionLocation.split('.');
        var length = optionLocation.length;
        var curIdx = 0;
        while (curIdx < length) {
            optionTarget = optionTarget[optionLocation[curIdx]];
            if (typeof optionTarget == 'undefined') {
                return;
            }
            curIdx++;
        }

        return optionTarget;
    }
        
    /**
     * 获取多级控制嵌套属性的基础方法
     * 返回ctrList中优先级最高（最靠前）的非undefined属性，ctrList中均无定义则返回undefined
     */
    function deepQuery(ctrList, optionLocation) {
        var finalOption;
        for (var i = 0, l = ctrList.length; i < l; i++) {
            finalOption = query(ctrList[i], optionLocation);
            if (typeof finalOption != 'undefined') {
                return finalOption;
            }
        }
    }
    
    /**
     * 获取多级控制嵌套属性的基础方法
     * 根据ctrList中优先级合并产出目标属性
     */
    function deepMerge(ctrList, optionLocation) {
        var finalOption;
        var len = ctrList.length;
        while (len--) {
            var tempOption = query(ctrList[len], optionLocation);
            if (typeof tempOption != 'undefined') {
                if (typeof finalOption == 'undefined') {
                    finalOption = zrUtil.clone(tempOption);
                }
                else {
                    zrUtil.merge(
                        finalOption, tempOption, true
                    );
                }
            }
        }
        
        return finalOption;
    }
    
    return {
        query : query,
        deepQuery : deepQuery,
        deepMerge : deepMerge
    };
});
define('echarts/util/number', [], function () {
    function _trim(str) {
        return str.replace(/^\s+/, '').replace(/\s+$/, '');
    }
    
    /**
     * 百分比计算
     */
    function parsePercent(value, maxValue) {
        if (typeof value === 'string') {
            if (_trim(value).match(/%$/)) {
                return parseFloat(value) / 100 * maxValue;
            }

            return parseFloat(value);
        }

        return value;
    }
    
    /**
     * 获取中心坐标
     */ 
    function parseCenter(zr, center) {
        return [
            parsePercent(center[0], zr.getWidth()),
            parsePercent(center[1], zr.getHeight())
        ];
    }

    /**
     * 获取自适应半径
     */ 
    function parseRadius(zr, radius) {
        // 传数组实现环形图，[内半径，外半径]，传单个则默认为外半径为
        if (!(radius instanceof Array)) {
            radius = [0, radius];
        }
        var zrSize = Math.min(zr.getWidth(), zr.getHeight()) / 2;
        return [
            parsePercent(radius[0], zrSize),
            parsePercent(radius[1], zrSize)
        ];
    }
    
    /**
     * 每三位默认加,格式化
     */
    function addCommas(x) {
        if (isNaN(x)) {
            return '-';
        }
        x = (x + '').split('.');
        return x[0].replace(/(\d{1,3})(?=(?:\d{3})+(?!\d))/g,'$1,') 
               + (x.length > 1 ? ('.' + x[1]) : '');
    }

    /**
     * 获取数字的小数位数
     * @param {number} val
     */
    
    // It is much faster than methods converting number to string as follows 
    //      var tmp = val.toString();
    //      return tmp.length - 1 - tmp.indexOf('.');
    // especially when precision is low
    function getPrecision(val) {
        var e = 1;
        var count = 0;
        while (Math.round(val * e) / e !== val) {
            e *= 10;
            count++;
        }
        return count;
    }
    
    return {
        parsePercent: parsePercent,
        parseCenter: parseCenter,
        parseRadius: parseRadius,
        addCommas: addCommas,
        getPrecision: getPrecision
    };
});
define('echarts/data/KDTree', ['require', './quickSelect'], function (require) {

    var quickSelect = require('./quickSelect');

    function Node(axis, data) {
        this.left = null;
        this.right = null;
        this.axis = axis;

        this.data = data;
    }

    /**
     * @constructor
     * @alias module:echarts/data/KDTree
     * @param {Array} points List of points.
     * each point needs an array property to repesent the actual data
     * @param {Number} [dimension]
     *        Point dimension.
     *        Default will use the first point's length as dimensiont
     */
    var KDTree = function (points, dimension) {
        if (!points.length) {
            return;
        }

        if (!dimension) {
            dimension = points[0].array.length;
        }
        this.dimension = dimension;
        this.root = this._buildTree(points, 0, points.length - 1, 0);

        // Use one stack to avoid allocation 
        // each time searching the nearest point
        this._stack = [];
        // Again avoid allocating a new array
        // each time searching nearest N points
        this._nearstNList = [];
    };

    /**
     * Resursively build the tree
     */
    KDTree.prototype._buildTree = function (points, left, right, axis) {
        if (right < left) {
            return null;
        }

        var medianIndex = Math.floor((left + right) / 2);
        medianIndex = quickSelect(
            points, left, right, medianIndex,
            function (a, b) {
                return a.array[axis] - b.array[axis];
            }
        );
        var median = points[medianIndex];

        var node = new Node(axis, median);

        axis = (axis + 1) % this.dimension;
        if (right > left) {
            node.left = this._buildTree(points, left, medianIndex - 1, axis);
            node.right = this._buildTree(points, medianIndex + 1, right, axis);   
        }

        return node;
    };

    /**
     * Find nearest point
     * @param  {Array} target Target point
     * @param  {Function} squaredDistance Squared distance function
     * @return {Array} Nearest point
     */
    KDTree.prototype.nearest = function (target, squaredDistance) {
        var curr = this.root;
        var stack = this._stack;
        var idx = 0;
        var minDist = Infinity;
        var nearestNode = null;
        if (curr.data !== target) {
            minDist = squaredDistance(curr.data, target);
            nearestNode = curr;
        }

        if (target.array[curr.axis] < curr.data.array[curr.axis]) {
            // Left first
            curr.right && (stack[idx++] = curr.right);
            curr.left && (stack[idx++] = curr.left);
        }
        else {
            // Right first
            curr.left && (stack[idx++] = curr.left);
            curr.right && (stack[idx++] = curr.right);
        }

        while (idx--) {
            curr = stack[idx];
            var currDist = target.array[curr.axis] - curr.data.array[curr.axis];
            var isLeft = currDist < 0;
            var needsCheckOtherSide = false;
            currDist = currDist * currDist;
            // Intersecting right hyperplane with minDist hypersphere
            if (currDist < minDist) {
                currDist = squaredDistance(curr.data, target);
                if (currDist < minDist && curr.data !== target) {
                    minDist = currDist;
                    nearestNode = curr;
                }
                needsCheckOtherSide = true;
            }
            if (isLeft) {
                if (needsCheckOtherSide) {
                    curr.right && (stack[idx++] = curr.right);
                }
                // Search in the left area
                curr.left && (stack[idx++] = curr.left);
            }
            else {
                if (needsCheckOtherSide) {
                    curr.left && (stack[idx++] = curr.left);
                }
                // Search the right area
                curr.right && (stack[idx++] = curr.right);
            }
        }

        return nearestNode.data;
    };

    KDTree.prototype._addNearest = function (found, dist, node) {
        var nearestNList = this._nearstNList;

        // Insert to the right position
        // Sort from small to large
        for (var i = found - 1; i > 0; i--) {
            if (dist >= nearestNList[i - 1].dist) {                
                break;
            }
            else {
                nearestNList[i].dist = nearestNList[i - 1].dist;
                nearestNList[i].node = nearestNList[i - 1].node;
            }
        }

        nearestNList[i].dist = dist;
        nearestNList[i].node = node;
    };

    /**
     * Find nearest N points
     * @param  {Array} target Target point
     * @param  {number} N
     * @param  {Function} squaredDistance Squared distance function
     * @param  {Array} [output] Output nearest N points
     */
    KDTree.prototype.nearestN = function (target, N, squaredDistance, output) {
        if (N <= 0) {
            output.length = 0;
            return output;
        }

        var curr = this.root;
        var stack = this._stack;
        var idx = 0;

        var nearestNList = this._nearstNList;
        for (var i = 0; i < N; i++) {
            // Allocate
            if (!nearestNList[i]) {
                nearestNList[i] = {};
            }
            nearestNList[i].dist = 0;
            nearestNList[i].node = null;
        }
        var currDist = squaredDistance(curr.data, target);

        var found = 0;
        if (curr.data !== target) {
            found++;
            this._addNearest(found, currDist, curr);
        }

        if (target.array[curr.axis] < curr.data.array[curr.axis]) {
            // Left first
            curr.right && (stack[idx++] = curr.right);
            curr.left && (stack[idx++] = curr.left);
        }
        else {
            // Right first
            curr.left && (stack[idx++] = curr.left);
            curr.right && (stack[idx++] = curr.right);
        }

        while (idx--) {
            curr = stack[idx];
            var currDist = target.array[curr.axis] - curr.data.array[curr.axis];
            var isLeft = currDist < 0;
            var needsCheckOtherSide = false;
            currDist = currDist * currDist;
            // Intersecting right hyperplane with minDist hypersphere
            if (found < N || currDist < nearestNList[found - 1].dist) {
                currDist = squaredDistance(curr.data, target);
                if (
                    (found < N || currDist < nearestNList[found - 1].dist)
                    && curr.data !== target
                ) {
                    if (found < N) {
                        found++;
                    }
                    this._addNearest(found, currDist, curr);
                }
                needsCheckOtherSide = true;
            }
            if (isLeft) {
                if (needsCheckOtherSide) {
                    curr.right && (stack[idx++] = curr.right);
                }
                // Search in the left area
                curr.left && (stack[idx++] = curr.left);
            }
            else {
                if (needsCheckOtherSide) {
                    curr.left && (stack[idx++] = curr.left);
                }
                // Search the right area
                curr.right && (stack[idx++] = curr.right);
            }
        }

        // Copy to output
        for (var i = 0; i < found; i++) {
            output[i] = nearestNList[i].node.data;
        }
        output.length = found;

        return output;
    };

    return KDTree;
});
define('echarts/data/quickSelect', ['require'], function (require) {

    function defaultCompareFunc(a, b) {
        return a - b;
    }

    function swapElement(list, idx0, idx1) {
        var tmp = list[idx0];
        list[idx0] = list[idx1];
        list[idx1] = tmp;
    }

    function select(list, left, right, nth, compareFunc) {
        var pivotIdx = left;
        while (right > left) {
            var pivotIdx = Math.round((right + left) / 2);
            var pivotValue = list[pivotIdx];
            // Swap pivot to the end
            swapElement(list, pivotIdx, right);
            pivotIdx = left;
            for (var i = left; i <= right - 1; i++) {
                if (compareFunc(pivotValue, list[i]) >= 0) {
                    swapElement(list, i, pivotIdx);
                    pivotIdx++;
                }
            }
            swapElement(list, right, pivotIdx);

            if (pivotIdx === nth) {
                return pivotIdx;
            } else if (pivotIdx < nth) {
                left = pivotIdx + 1;
            } else {
                right = pivotIdx - 1;
            }
        }
        // Left == right
        return left;
    }

    /**
     * @alias module:echarts/data/quickSelect
     * @param {Array} list
     * @param {number} [left]
     * @param {number} [right]
     * @param {number} nth
     * @param {Function} [compareFunc]
     * @example
     *     var quickSelect = require('echarts/data/quickSelect');
     *     var list = [5, 2, 1, 4, 3]
     *     quickSelect(list, 3);
     *     quickSelect(list, 0, 3, 1, function (a, b) {return a - b});
     *
     * @return {number}
     */
    function quickSelect(list, left, right, nth, compareFunc) {
        if (arguments.length <= 3) {
            nth = left;
            if (arguments.length == 2) {
                compareFunc = defaultCompareFunc;
            } else {
                compareFunc = right;
            }
            left = 0;
            right = list.length - 1;
        }
        return select(list, left, right, nth, compareFunc);
    }
    
    return quickSelect;
});
define('echarts/component/dataView', ['require', './base', '../config', 'zrender/tool/util', '../component'], function (require) {
    var Base = require('./base');

    var ecConfig = require('../config');
    var zrUtil = require('zrender/tool/util');
    
    /**
     * 构造函数
     * @param {Object} messageCenter echart消息中心
     * @param {ZRender} zr zrender实例
     * @param {Object} option 提示框参数
     * @param {HtmlElement} dom 目标对象
     */
    function DataView(ecTheme, messageCenter, zr, option, myChart) {
        Base.call(this, ecTheme, messageCenter, zr, option, myChart);

        this.dom = myChart.dom;
        
        // dataview dom & css
        this._tDom = document.createElement('div');
        this._textArea = document.createElement('textArea');
        this._buttonRefresh = document.createElement('button');
        this._buttonClose = document.createElement('button');
        this._hasShow = false;

        // 缓存一些高宽数据
        this._zrHeight = zr.getHeight();
        this._zrWidth = zr.getWidth();
    
        this._tDom.className = 'echarts-dataview';
        this.hide();
        this.dom.firstChild.appendChild(this._tDom);

        if (window.addEventListener) {
            this._tDom.addEventListener('click', this._stop);
            this._tDom.addEventListener('mousewheel', this._stop);
            this._tDom.addEventListener('mousemove', this._stop);
            this._tDom.addEventListener('mousedown', this._stop);
            this._tDom.addEventListener('mouseup', this._stop);

            // mobile支持
            this._tDom.addEventListener('touchstart', this._stop);
            this._tDom.addEventListener('touchmove', this._stop);
            this._tDom.addEventListener('touchend', this._stop);
        }
        else {
            this._tDom.attachEvent('onclick', this._stop);
            this._tDom.attachEvent('onmousewheel', this._stop);
            this._tDom.attachEvent('onmousemove', this._stop);
            this._tDom.attachEvent('onmousedown', this._stop);
            this._tDom.attachEvent('onmouseup', this._stop);
        }
    }
    
    DataView.prototype = {
        type : ecConfig.COMPONENT_TYPE_DATAVIEW,
        _lang : ['Data View', 'close', 'refresh'],
        // 通用样式
        _gCssText : 'position:absolute;'
                    + 'display:block;'
                    + 'overflow:hidden;'
                    + 'transition:height 0.8s,background-color 1s;'
                    + '-moz-transition:height 0.8s,background-color 1s;'
                    + '-webkit-transition:height 0.8s,background-color 1s;'
                    + '-o-transition:height 0.8s,background-color 1s;'
                    + 'z-index:1;'
                    + 'left:0;'
                    + 'top:0;',
        hide : function () {
            this._sizeCssText = 'width:' + this._zrWidth + 'px;'
                           + 'height:' + 0 + 'px;'
                           + 'background-color:#f0ffff;';
            this._tDom.style.cssText = this._gCssText + this._sizeCssText;
            // 这是个很恶心的事情
            /*
            this.dom.onselectstart = function () {
                return false;
            };
            */
        },

        show : function (newOption) {
            this._hasShow = true;
            var lang = this.query(this.option, 'toolbox.feature.dataView.lang')
                       || this._lang;

            this.option = newOption;

            this._tDom.innerHTML = '<p style="padding:8px 0;margin:0 0 10px 0;'
                              + 'border-bottom:1px solid #eee">'
                              + (lang[0] || this._lang[0])
                              + '</p>';

            var customContent = this.query(
                this.option, 'toolbox.feature.dataView.optionToContent'
            );
            if (typeof customContent != 'function') {
                this._textArea.value = this._optionToContent();
            }
            else {
                // innerHTML the custom optionToContent;
                this._textArea = document.createElement('div');
                this._textArea.innerHTML = customContent(this.option);
            }

            this._textArea.style.cssText =
                'display:block;margin:0 0 8px 0;padding:4px 6px;overflow:auto;'
                + 'width:100%;'
                + 'height:' + (this._zrHeight - 100) + 'px;';

            this._tDom.appendChild(this._textArea);

            this._buttonClose.style.cssText = 'float:right;padding:1px 6px;';
            this._buttonClose.innerHTML = lang[1] || this._lang[1];
            var self = this;
            this._buttonClose.onclick = function (){
                self.hide();
            };
            this._tDom.appendChild(this._buttonClose);

            if (this.query(this.option, 'toolbox.feature.dataView.readOnly')
                === false
            ) {
                this._buttonRefresh.style.cssText =
                    'float:right;margin-right:10px;padding:1px 6px;';
                this._buttonRefresh.innerHTML = lang[2] || this._lang[2];
                this._buttonRefresh.onclick = function (){
                    self._save();
                };
                this._textArea.readOnly = false;
                this._textArea.style.cursor = 'default';
            }
            else {
                this._buttonRefresh.style.cssText =
                    'display:none';
                this._textArea.readOnly = true;
                this._textArea.style.cursor = 'text';
            }
            this._tDom.appendChild(this._buttonRefresh);

            this._sizeCssText = 'width:' + this._zrWidth + 'px;'
                           + 'height:' + this._zrHeight + 'px;'
                           + 'background-color:#fff;';
            this._tDom.style.cssText = this._gCssText + this._sizeCssText;
            // 这是个很恶心的事情
            /*
            this.dom.onselectstart = function () {
                return true;
            };
            */
        },

        _optionToContent : function () {
            var i;
            var j;
            var k;
            var len;
            var data;
            var valueList;
            var axisList = [];
            var content = '';
            if (this.option.xAxis) {
                if (this.option.xAxis instanceof Array) {
                    axisList = this.option.xAxis;
                } else {
                    axisList = [this.option.xAxis];
                }
                for (i = 0, len = axisList.length; i < len; i++) {
                    // 横纵默认为类目
                    if ((axisList[i].type || 'category') == 'category') {
                        valueList = [];
                        for (j = 0, k = axisList[i].data.length; j < k; j++) {
                            valueList.push(this.getDataFromOption(axisList[i].data[j]));
                        }
                        content += valueList.join(', ') + '\n\n';
                    }
                }
            }

            if (this.option.yAxis) {
                if (this.option.yAxis instanceof Array) {
                    axisList = this.option.yAxis;
                } else {
                    axisList = [this.option.yAxis];
                }
                for (i = 0, len = axisList.length; i < len; i++) {
                    if (axisList[i].type  == 'category') {
                        valueList = [];
                        for (j = 0, k = axisList[i].data.length; j < k; j++) {
                            valueList.push(this.getDataFromOption(axisList[i].data[j]));
                        }
                        content += valueList.join(', ') + '\n\n';
                    }
                }
            }

            var series = this.option.series;
            var itemName;
            for (i = 0, len = series.length; i < len; i++) {
                valueList = [];
                for (j = 0, k = series[i].data.length; j < k; j++) {
                    data = series[i].data[j];
                    if (series[i].type == ecConfig.CHART_TYPE_PIE
                        || series[i].type == ecConfig.CHART_TYPE_MAP
                    ) {
                        itemName = (data.name || '-') + ':';
                    }
                    else {
                        itemName = '';
                    }
                    
                    if (series[i].type == ecConfig.CHART_TYPE_SCATTER) {
                        data = this.getDataFromOption(data).join(', ');
                    }
                    valueList.push(itemName + this.getDataFromOption(data));
                }
                content += (series[i].name || '-') + ' : \n';
                content += valueList.join(
                    series[i].type == ecConfig.CHART_TYPE_SCATTER ? '\n': ', '
                );
                content += '\n\n';
            }

            return content;
        },

        _save : function () {
            var customContent = this.query(
                this.option, 'toolbox.feature.dataView.contentToOption'
            );
            if (typeof customContent != 'function') {
                var text = this._textArea.value.split('\n');
                var content = [];
                for (var i = 0, l = text.length; i < l; i++) {
                    text[i] = this._trim(text[i]);
                    if (text[i] !== '') {
                        content.push(text[i]);
                    }
                }
                this._contentToOption(content);
            }
            else {
                // return the textArea dom for custom contentToOption
                customContent(this._textArea, this.option);
            }

            this.hide();
            
            var self = this;
            setTimeout(
                function (){
                    self.messageCenter && self.messageCenter.dispatch(
                        ecConfig.EVENT.DATA_VIEW_CHANGED,
                        null,
                        {option : self.option},
                        self.myChart
                    );
                },
                // 有动画，所以高级浏览器时间更长点
                self.canvasSupported ? 800 : 100
            );
        },

        _contentToOption : function (content) {
            var i;
            var j;
            var k;
            var len;
            var data;
            var axisList = [];

            var contentIdx = 0;
            var contentValueList;
            var value;

            if (this.option.xAxis) {
                if (this.option.xAxis instanceof Array) {
                    axisList = this.option.xAxis;
                } else {
                    axisList = [this.option.xAxis];
                }
                for (i = 0, len = axisList.length; i < len; i++) {
                    // 横纵默认为类目
                    if ((axisList[i].type || 'category') == 'category'
                    ) {
                        contentValueList = content[contentIdx].split(',');
                        for (j = 0, k = axisList[i].data.length; j < k; j++) {
                            value = this._trim(contentValueList[j] || '');
                            data = axisList[i].data[j];
                            if (typeof axisList[i].data[j].value != 'undefined'
                            ) {
                                axisList[i].data[j].value = value;
                            }
                            else {
                                axisList[i].data[j] = value;
                            }
                        }
                        contentIdx++;
                    }
                }
            }

            if (this.option.yAxis) {
                if (this.option.yAxis instanceof Array) {
                    axisList = this.option.yAxis;
                } else {
                    axisList = [this.option.yAxis];
                }
                for (i = 0, len = axisList.length; i < len; i++) {
                    if (axisList[i].type  == 'category') {
                        contentValueList = content[contentIdx].split(',');
                        for (j = 0, k = axisList[i].data.length; j < k; j++) {
                            value = this._trim(contentValueList[j] || '');
                            data = axisList[i].data[j];
                            if (typeof axisList[i].data[j].value != 'undefined'
                            ) {
                                axisList[i].data[j].value = value;
                            }
                            else {
                                axisList[i].data[j] = value;
                            }
                        }
                        contentIdx++;
                    }
                }
            }

            var series = this.option.series;
            for (i = 0, len = series.length; i < len; i++) {
                contentIdx++;
                if (series[i].type == ecConfig.CHART_TYPE_SCATTER) {
                    for (var j = 0, k = series[i].data.length; j < k; j++) {
                        contentValueList = content[contentIdx];
                        value = contentValueList.replace(' ','').split(',');
                        if (typeof series[i].data[j].value != 'undefined'
                        ) {
                            series[i].data[j].value = value;
                        }
                        else {
                            series[i].data[j] = value;
                        }
                        contentIdx++;
                    }
                }
                else {
                    contentValueList = content[contentIdx].split(',');
                    for (var j = 0, k = series[i].data.length; j < k; j++) {
                        value = (contentValueList[j] || '').replace(/.*:/,'');
                        value = this._trim(value);
                        value = (value != '-' && value !== '')
                                ? (value - 0)
                                : '-';
                        if (typeof series[i].data[j].value != 'undefined'
                        ) {
                            series[i].data[j].value = value;
                        }
                        else {
                            series[i].data[j] = value;
                        }
                    }
                    contentIdx++;
                }
            }
        },

        _trim : function (str){
            var trimer = new RegExp(
                '(^[\\s\\t\\xa0\\u3000]+)|([\\u3000\\xa0\\s\\t]+\x24)', 'g'
            );
            return str.replace(trimer, '');
        },

        // 阻塞zrender事件
        _stop : function (e){
            e = e || window.event;
            if (e.stopPropagation) {
                e.stopPropagation();
            }
            else {
                e.cancelBubble = true;
            }
        },

        /**
         * zrender事件响应：窗口大小改变
         */
        resize : function () {
            this._zrHeight = this.zr.getHeight();
            this._zrWidth = this.zr.getWidth();
            if (this._tDom.offsetHeight > 10) {
                this._sizeCssText = 'width:' + this._zrWidth + 'px;'
                               + 'height:' + this._zrHeight + 'px;'
                               + 'background-color:#fff;';
                this._tDom.style.cssText = this._gCssText + this._sizeCssText;
                this._textArea.style.cssText = 'display:block;margin:0 0 8px 0;'
                                        + 'padding:4px 6px;overflow:auto;'
                                        + 'width:100%;'
                                        + 'height:' + (this._zrHeight - 100) + 'px;';
            }
        },

        /**
         * 释放后实例不可用，重载基类方法
         */
        dispose : function () {
            if (window.removeEventListener) {
                this._tDom.removeEventListener('click', this._stop);
                this._tDom.removeEventListener('mousewheel', this._stop);
                this._tDom.removeEventListener('mousemove', this._stop);
                this._tDom.removeEventListener('mousedown', this._stop);
                this._tDom.removeEventListener('mouseup', this._stop);

                // mobile支持
                this._tDom.removeEventListener('touchstart', this._stop);
                this._tDom.removeEventListener('touchmove', this._stop);
                this._tDom.removeEventListener('touchend', this._stop);
            }
            else {
                this._tDom.detachEvent('onclick', this._stop);
                this._tDom.detachEvent('onmousewheel', this._stop);
                this._tDom.detachEvent('onmousemove', this._stop);
                this._tDom.detachEvent('onmousedown', this._stop);
                this._tDom.detachEvent('onmouseup', this._stop);
            }

            this._buttonRefresh.onclick = null;
            this._buttonClose.onclick = null;

            if (this._hasShow) {
                this._tDom.removeChild(this._textArea);
                this._tDom.removeChild(this._buttonRefresh);
                this._tDom.removeChild(this._buttonClose);
            }

            this._textArea = null;
            this._buttonRefresh = null;
            this._buttonClose = null;

            this.dom.firstChild.removeChild(this._tDom);
            this._tDom = null;
        }
    };
    
    zrUtil.inherits(DataView, Base);
    
    require('../component').define('dataView', DataView);
    
    return DataView;
});
define('zrender/tool/computeBoundingBox', ['require', './vector', './curve'], function (require) {
        var vec2 = require('./vector');
        var curve = require('./curve');

        /**
         * 从顶点数组中计算出最小包围盒，写入`min`和`max`中
         * @module zrender/tool/computeBoundingBox
         * @param {Array<Object>} points 顶点数组
         * @param {number} min
         * @param {number} max
         */
        function computeBoundingBox(points, min, max) {
            if (points.length === 0) {
                return;
            }
            var left = points[0][0];
            var right = points[0][0];
            var top = points[0][1];
            var bottom = points[0][1];
            
            for (var i = 1; i < points.length; i++) {
                var p = points[i];
                if (p[0] < left) {
                    left = p[0];
                }
                if (p[0] > right) {
                    right = p[0];
                }
                if (p[1] < top) {
                    top = p[1];
                }
                if (p[1] > bottom) {
                    bottom = p[1];
                }
            }

            min[0] = left;
            min[1] = top;
            max[0] = right;
            max[1] = bottom;
        }

        /**
         * 从三阶贝塞尔曲线(p0, p1, p2, p3)中计算出最小包围盒，写入`min`和`max`中
         * @memberOf module:zrender/tool/computeBoundingBox
         * @param {Array.<number>} p0
         * @param {Array.<number>} p1
         * @param {Array.<number>} p2
         * @param {Array.<number>} p3
         * @param {Array.<number>} min
         * @param {Array.<number>} max
         */
        function computeCubeBezierBoundingBox(p0, p1, p2, p3, min, max) {
            var xDim = [];
            curve.cubicExtrema(p0[0], p1[0], p2[0], p3[0], xDim);
            for (var i = 0; i < xDim.length; i++) {
                xDim[i] = curve.cubicAt(p0[0], p1[0], p2[0], p3[0], xDim[i]);
            }
            var yDim = [];
            curve.cubicExtrema(p0[1], p1[1], p2[1], p3[1], yDim);
            for (var i = 0; i < yDim.length; i++) {
                yDim[i] = curve.cubicAt(p0[1], p1[1], p2[1], p3[1], yDim[i]);
            }

            xDim.push(p0[0], p3[0]);
            yDim.push(p0[1], p3[1]);

            var left = Math.min.apply(null, xDim);
            var right = Math.max.apply(null, xDim);
            var top = Math.min.apply(null, yDim);
            var bottom = Math.max.apply(null, yDim);

            min[0] = left;
            min[1] = top;
            max[0] = right;
            max[1] = bottom;
        }

        /**
         * 从二阶贝塞尔曲线(p0, p1, p2)中计算出最小包围盒，写入`min`和`max`中
         * @memberOf module:zrender/tool/computeBoundingBox
         * @param {Array.<number>} p0
         * @param {Array.<number>} p1
         * @param {Array.<number>} p2
         * @param {Array.<number>} min
         * @param {Array.<number>} max
         */
        function computeQuadraticBezierBoundingBox(p0, p1, p2, min, max) {
            // Find extremities, where derivative in x dim or y dim is zero
            var t1 = curve.quadraticExtremum(p0[0], p1[0], p2[0]);
            var t2 = curve.quadraticExtremum(p0[1], p1[1], p2[1]);

            t1 = Math.max(Math.min(t1, 1), 0);
            t2 = Math.max(Math.min(t2, 1), 0);

            var ct1 = 1 - t1;
            var ct2 = 1 - t2;

            var x1 = ct1 * ct1 * p0[0] 
                     + 2 * ct1 * t1 * p1[0] 
                     + t1 * t1 * p2[0];
            var y1 = ct1 * ct1 * p0[1] 
                     + 2 * ct1 * t1 * p1[1] 
                     + t1 * t1 * p2[1];

            var x2 = ct2 * ct2 * p0[0] 
                     + 2 * ct2 * t2 * p1[0] 
                     + t2 * t2 * p2[0];
            var y2 = ct2 * ct2 * p0[1] 
                     + 2 * ct2 * t2 * p1[1] 
                     + t2 * t2 * p2[1];
            min[0] = Math.min(p0[0], p2[0], x1, x2);
            min[1] = Math.min(p0[1], p2[1], y1, y2);
            max[0] = Math.max(p0[0], p2[0], x1, x2);
            max[1] = Math.max(p0[1], p2[1], y1, y2);
        }

        var start = vec2.create();
        var end = vec2.create();
        var extremity = vec2.create();
        /**
         * 从圆弧中计算出最小包围盒，写入`min`和`max`中
         * @method
         * @memberOf module:zrender/tool/computeBoundingBox
         * @param {Array.<number>} center 圆弧中心点
         * @param {number} radius 圆弧半径
         * @param {number} startAngle 圆弧开始角度
         * @param {number} endAngle 圆弧结束角度
         * @param {number} anticlockwise 是否是顺时针
         * @param {Array.<number>} min
         * @param {Array.<number>} max
         */
        var computeArcBoundingBox = function (
            x, y, r, startAngle, endAngle, anticlockwise, min, max
        ) { 
            if (Math.abs(startAngle - endAngle) >= Math.PI * 2) {
                // Is a circle
                min[0] = x - r;
                min[1] = y - r;
                max[0] = x + r;
                max[1] = y + r;
                return;
            }

            start[0] = Math.cos(startAngle) * r + x;
            start[1] = Math.sin(startAngle) * r + y;

            end[0] = Math.cos(endAngle) * r + x;
            end[1] = Math.sin(endAngle) * r + y;

            vec2.min(min, start, end);
            vec2.max(max, start, end);
            
            // Thresh to [0, Math.PI * 2]
            startAngle = startAngle % (Math.PI * 2);
            if (startAngle < 0) {
                startAngle = startAngle + Math.PI * 2;
            }
            endAngle = endAngle % (Math.PI * 2);
            if (endAngle < 0) {
                endAngle = endAngle + Math.PI * 2;
            }

            if (startAngle > endAngle && !anticlockwise) {
                endAngle += Math.PI * 2;
            } else if (startAngle < endAngle && anticlockwise) {
                startAngle += Math.PI * 2;
            }
            if (anticlockwise) {
                var tmp = endAngle;
                endAngle = startAngle;
                startAngle = tmp;
            }

            // var number = 0;
            // var step = (anticlockwise ? -Math.PI : Math.PI) / 2;
            for (var angle = 0; angle < endAngle; angle += Math.PI / 2) {
                if (angle > startAngle) {
                    extremity[0] = Math.cos(angle) * r + x;
                    extremity[1] = Math.sin(angle) * r + y;

                    vec2.min(min, extremity, min);
                    vec2.max(max, extremity, max);
                }
            }
        };

        computeBoundingBox.cubeBezier = computeCubeBezierBoundingBox;
        computeBoundingBox.quadraticBezier = computeQuadraticBezierBoundingBox;
        computeBoundingBox.arc = computeArcBoundingBox;

        return computeBoundingBox;
    });
define('echarts/util/shape/Cross', ['require', 'zrender/shape/Base', 'zrender/shape/Line', 'zrender/tool/util', './normalIsCover'], function (require) {
    var Base = require('zrender/shape/Base');
    var LineShape = require('zrender/shape/Line');
    var zrUtil = require('zrender/tool/util');

    function Cross(options) {
        Base.call(this, options);
    }

    Cross.prototype =  {
        type : 'cross',

        /**
         * 创建矩形路径
         * @param {Context2D} ctx Canvas 2D上下文
         * @param {Object} style 样式
         */
        buildPath : function (ctx, style) {
            var rect = style.rect;
            style.xStart = rect.x;
            style.xEnd = rect.x + rect.width;
            style.yStart = style.yEnd = style.y;
            LineShape.prototype.buildPath(ctx, style);
            style.xStart = style.xEnd = style.x;
            style.yStart = rect.y;
            style.yEnd = rect.y + rect.height;
            LineShape.prototype.buildPath(ctx, style);
        },

        /**
         * 返回矩形区域，用于局部刷新和文字定位
         * @param {Object} style
         */
        getRect : function (style) {
            return style.rect;
        },

        isCover : require('./normalIsCover')
    };

    zrUtil.inherits(Cross, Base);

    return Cross;
});
define('echarts/util/shape/Candle', ['require', 'zrender/shape/Base', 'zrender/tool/util', './normalIsCover'], function (require) {
    var Base = require('zrender/shape/Base');
    var zrUtil = require('zrender/tool/util');

    function Candle(options) {
        Base.call(this, options);
    }

    Candle.prototype =  {
        type: 'candle',
        _numberOrder : function (a, b) {
            return b - a;
        },

        /**
         * 创建矩形路径
         * @param {Context2D} ctx Canvas 2D上下文
         * @param {Object} style 样式
         */
        buildPath : function (ctx, style) {
            var yList = zrUtil.clone(style.y).sort(this._numberOrder);

            ctx.moveTo(style.x, yList[3]);
            ctx.lineTo(style.x, yList[2]);
            ctx.moveTo(style.x - style.width / 2, yList[2]);
            ctx.rect(
                style.x - style.width / 2,
                yList[2],
                style.width,
                yList[1] - yList[2]
            );
            ctx.moveTo(style.x, yList[1]);
            ctx.lineTo(style.x, yList[0]);
        },

        /**
         * 返回矩形区域，用于局部刷新和文字定位
         * @param {Object} style
         */
        getRect : function (style) {
            if (!style.__rect) {
                var lineWidth = 0;
                if (style.brushType == 'stroke' || style.brushType == 'fill') {
                    lineWidth = style.lineWidth || 1;
                }

                var yList = zrUtil.clone(style.y).sort(this._numberOrder);
                style.__rect = {
                    x : Math.round(style.x - style.width / 2 - lineWidth / 2),
                    y : Math.round(yList[3] - lineWidth / 2),
                    width : style.width + lineWidth,
                    height : yList[0] - yList[3] + lineWidth
                };
            }

            return style.__rect;
        },


        isCover : require('./normalIsCover')
    };

    zrUtil.inherits(Candle, Base);

    return Candle;
});
define('echarts/util/shape/Chain', ['require', 'zrender/shape/Base', './Icon', 'zrender/shape/util/dashedLineTo', 'zrender/tool/util', 'zrender/tool/matrix'], function (require) {
    var Base = require('zrender/shape/Base');
    var IconShape = require('./Icon');

    var dashedLineTo = require('zrender/shape/util/dashedLineTo');
    var zrUtil = require('zrender/tool/util');
    var matrix = require('zrender/tool/matrix');

    function Chain(options) {
        Base.call(this, options);
    }

    Chain.prototype =  {
        type : 'chain',

        /**
         * 画刷
         * @param ctx       画布句柄
         * @param e         形状实体
         * @param isHighlight   是否为高亮状态
         * @param updateCallback 需要异步加载资源的shape可以通过这个callback(e)
         *                       让painter更新视图，base.brush没用，需要的话重载brush
         */
        brush : function (ctx, isHighlight) {
            var style = this.style;

            if (isHighlight) {
                // 根据style扩展默认高亮样式
                style = this.getHighlightStyle(
                    style,
                    this.highlightStyle || {}
                );
            }

            ctx.save();
            this.setContext(ctx, style);

            // 设置transform
            this.setTransform(ctx);

            ctx.save();
            ctx.beginPath();
            this.buildLinePath(ctx, style);
            ctx.stroke();
            ctx.restore();
            
            this.brushSymbol(ctx, style);

            ctx.restore();
            return;
        },

        /**
         * 创建线条路径
         * @param {Context2D} ctx Canvas 2D上下文
         * @param {Object} style 样式
         */
        buildLinePath : function (ctx, style) {
            var x = style.x;
            var y = style.y + 5;
            var width = style.width;
            var height = style.height / 2 - 10;

            ctx.moveTo(x, y);
            ctx.lineTo(x, y + height);
            ctx.moveTo(x + width, y);
            ctx.lineTo(x + width, y + height);

            ctx.moveTo(x, y + height / 2);
            if (!style.lineType || style.lineType == 'solid') {
                ctx.lineTo(x + width, y + height / 2);
            }
            else if (style.lineType == 'dashed' || style.lineType == 'dotted') {
                var dashLength = (style.lineWidth || 1)
                             * (style.lineType == 'dashed' ? 5 : 1);
                dashedLineTo(ctx, x, y + height / 2, x + width, y + height / 2, dashLength);
            }
        },

        /**
         * 标线始末标注
         */
        brushSymbol : function (ctx, style) {
            var y = style.y + style.height / 4;
            ctx.save();

            var chainPoint = style.chainPoint;
            var curPoint;
            for (var idx = 0, l = chainPoint.length; idx < l; idx++) {
                curPoint = chainPoint[idx];
                if (curPoint.symbol != 'none') {
                    ctx.beginPath();
                    var symbolSize = curPoint.symbolSize;
                    IconShape.prototype.buildPath(
                        ctx,
                        {
                            iconType : curPoint.symbol,
                            x : curPoint.x - symbolSize,
                            y : y - symbolSize,
                            width : symbolSize * 2,
                            height : symbolSize * 2,
                            n : curPoint.n
                        }
                    );
                    ctx.fillStyle = curPoint.isEmpty ? '#fff' : style.strokeColor;
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }

                if (curPoint.showLabel) {
                    ctx.font = curPoint.textFont;
                    ctx.fillStyle = curPoint.textColor;
                    ctx.textAlign = curPoint.textAlign;
                    ctx.textBaseline = curPoint.textBaseline;
                    if (curPoint.rotation) {
                        ctx.save();
                        this._updateTextTransform(ctx, curPoint.rotation);
                        ctx.fillText(curPoint.name, curPoint.textX, curPoint.textY);
                        ctx.restore();
                    }
                    else {
                        ctx.fillText(curPoint.name, curPoint.textX, curPoint.textY);
                    }
                }
            }

            ctx.restore();
        },

        _updateTextTransform : function (ctx, rotation) {
            var _transform = matrix.create();
            matrix.identity(_transform);

            if (rotation[0] !== 0) {
                var originX = rotation[1] || 0;
                var originY = rotation[2] || 0;
                if (originX || originY) {
                    matrix.translate(
                        _transform, _transform, [-originX, -originY]
                    );
                }
                matrix.rotate(_transform, _transform, rotation[0]);
                if (originX || originY) {
                    matrix.translate(
                        _transform, _transform, [originX, originY]
                    );
                }
            }

            // 保存这个变换矩阵
            ctx.transform.apply(ctx, _transform);
        },

        isCover : function (x, y) {
            var rect = this.style;
            if (x >= rect.x
                && x <= (rect.x + rect.width)
                && y >= rect.y
                && y <= (rect.y + rect.height)
            ) {
                // 矩形内
                return true;
            }
            else {
                return false;
            }
        }
    };

    zrUtil.inherits(Chain, Base);

    return Chain;
});
define('zrender', ['zrender/zrender'], function (zrender) { return zrender;});
define('echarts', ['echarts/echarts'], function (echarts) { return echarts;});

var zrender = require('zrender');
zrender.tool = {
    color: require('zrender/tool/color'),
    math: require('zrender/tool/math'),
    util: require('zrender/tool/util'),
    vector: require('zrender/tool/vector'),
    area: require('zrender/tool/area'),
    event: require('zrender/tool/event')
}

zrender.animation = {
    Animation: require('zrender/animation/Animation'),
    Cip: require('zrender/animation/Clip'),
    easing: require('zrender/animation/easing')
}
var echarts = require('echarts');
echarts.config = require('echarts/config');



require("echarts/chart/pie");

_global['echarts'] = echarts;
_global['zrender'] = zrender;

})(window);
