LearnosityAmd.define([
    'jquery-v1.10.2'
], function ($) {
    'use strict';

    var templates = {
        modal: '<div class="geogebra-exercise"></div>'
    };
    var libLoaded = false;
    var matApiParameters = ["enableRightClick", "showToolBar", "showMenuBar",
        "showAlgebraInput", "enableShiftDragZoom", "allowStyleBar"];
    var callbacks = null;
    function loadDependencies(callback) {
        var loadScript = function (src) {
            var status = $.Deferred();
            var head = document.getElementsByTagName('head')[0];
            var script = document.createElement('script');
            script.src = src;
            script.onload = status.resolve;
            head.appendChild(script);

            return status.promise();
        };
        if(callbacks === null){
            callbacks = [callback];
            $.when(
                loadScript('https://cdn.geogebra.org/apps/deployggb.js')
            ).done(function () {
                libLoaded = true;
                callbacks && callbacks.forEach(function(fn){fn()});
            });
        } else {
            callbacks.push(callback);
        }
    }

    function GeogebraExercise(options, tools) {
        this.questionsApiVersion = options.questionsApiVersion;
        this.renderComponent = tools.renderComponent;
        this.events = options.events;
        this.validatePermanent = true;
        this.$el = options.$el;
        this.question = options.question;
        this.response = options.response || {};
        this.questionState = options.state;
        this.loadCallbacks = [];
        this.api = null;
        this.modalId = 'ggbAssess_' + Math.round(Math.random() * 1E12);
        var facade = options.getFacade();
        var that = this;
        facade.showSolution = function() {
            that.afterLoaded(function() {
                if (that.objectState) {
                    for (const label of Object.keys(that.objectState)) {
                        that.api.setFixed(label, ...that.objectState[label])
                    }
                    delete(that.objectState);
                }
                that.api.setValue("showsolution", true);
            });
        };

        facade.resetValidationUI = function() {
            that.afterLoaded(function() {
                that.api.setValue("showsolution", false);
                that.api.setValue("showanswer", false);
                that.api.setValue("validate", false);
            });
        };

        this.events.on("validate", function (validationEvent) {
            that.afterLoaded(function() {
                that.showValidation(validationEvent);
            });
        });

        if (!libLoaded) {
            loadDependencies(function () {
                this.render();
            }.bind(this));
        } else {
            this.render();
        }
        this.events.trigger('ready');
    }

    function computeSeed(responseId){
        var h=0;
        for (var i = 8; i < responseId.length; i += 8) {
            h = h ^ parseInt(responseId.substring(i - 8, i));
        }
        return Math.abs(h);
    }

    function extend(prot, fns) {
        for (var k in fns) {
            prot[k] = fns[k];
        }
    }

    function toBoolean(param) {
        // note that !!"false" === true, so this check is
        // necessary if the parameter might be a string
        if (typeof param == "string") {
            return param == "true";
        } else {
            return !!param;
        }
    }

    extend(GeogebraExercise.prototype, {
        afterLoaded: function(callback) {
            if (this.api) {
                callback();
            } else {
                this.loadCallbacks.push(callback);
            }
        },

        render: function () {
            this.$body = $('body');
            this.createModal(this.question, this.response, this.questionState === "review");
        },

        showValidation: function(options) {
            this.blockListeners = true;
            var showAnswer = this.api.getValueString("showanswer");
            if (showAnswer && options && options.showCorrectAnswers) {
                this.api.setValue("showanswer", 1);
            } else {
                this.api.setValue("validate", 1);
            }

            this.blockListeners = false;
        },
        parseAdvanced: function(question, defaultOptions) {
            console.log(question.advanced);
            try {
                var advanced = JSON.parse(question.advanced || "{}");
                for (var key in advanced) {
                    if (advanced.hasOwnProperty(key)) {
                        defaultOptions[key] = advanced[key];
                    }
                }
            } catch(e) {
                console.log("Error handling advanced properties: " + question.advanced);
            }
        },
        createModal: function (question, response, review) {
            function setMaterial(opt, url) {
                if (url.match(/ggbm.at/) || url.match(/geogebra.org\/m/)) {
                    opt.material_id = url.split("/").reverse()[0];
                } else {
                    opt.filename = url;
                }
            }
            this.$el.empty();
            $("<div class=\"ggb-validation\">").appendTo(this.$el);
            var that = this;
            var $modal = $(templates.modal).appendTo(this.$el);
            if (question.instant_feedback && !review) {
                var button = $("<div/>");
                this.renderComponent("CheckAnswerButton", button[0]);
                button.appendTo(this.$el);
                button.on("click", function () {
                    that.validatePermanent = false;
                });
            }
            var events = this.events;
            var updateScore = function (objName, undoPoint) {
                var api = that.api;
                var val = api.getExerciseFraction();
                var max_score = api.getValue("maxscore");
                if (val < 1 && objName != "validate" && api.getValue("validate") > 0
                    && !that.blockListeners && !that.validatePermanent) {
                    api.setValue("validate", 0);
                }
                var fraction = response.fraction;  //TODO ignore change between undefined and 0
                if (fraction != val || undoPoint) {
                    var evt = {"base64": api.getBase64(), "fraction": val,
                        "max_score": max_score, "thumbnailBase64": api.getThumbnailBase64(),
                        "ggbVersion": api.getVersion(), "ggbSeed": defaultOptions.randomSeed
                    };
                    var appletParameters = $modal.find(".appletParameters");
                    for (const apiParameter of matApiParameters) {
                        evt[apiParameter] = toBoolean(appletParameters.attr("data-param-" + apiParameter));
                    }
                    events.trigger("changed", evt);
                }
                response.fraction = val;
            }
            var height = question.height || 550;
            var enableUndoRedo = question.undo_redo || false;
            this.$el.css("minHeight", height);
            var defaultOptions = {
                "id": that.modalId,
                "width": question.width || 750,
                "height": height,
                "borderColor": null,
                "enableLabelDrags": false,
                "showLogging": true,
                "useBrowserForJS": false,
                "scaleContainerClass": "learnosity-item",
                "randomSeed": computeSeed(this.question.response_id),
                "enableUndoRedo": enableUndoRedo,
                "appletOnLoad": function (api) {
                    that.api = api;
                    updateScore("validate");
                    if (review) {
                        that.initReviewMode();
                    }
                    $.each(that.loadCallbacks, Object.call);
                    that.loadCallbacks = [];
                    if (!review) {
                        api.registerUpdateListener(updateScore, question.scoring_object);
                        api.registerStoreUndoListener(function (a) {
                            updateScore(a, true);
                        });
                        api.registerClientListener(function (a) {
                            if (a.type == "editorKeyTyped") {
                                updateScore(a, true);
                            }
                        });
                    }
                }
            };
            this.parseAdvanced(question, defaultOptions);
            if (response.base64) {
                for (const apiParameter of matApiParameters) {
                    defaultOptions[apiParameter] = toBoolean(response[apiParameter]);
                }
                defaultOptions.ggbBase64 = response.base64;
                defaultOptions.randomize = false;
            } else {
                setMaterial(defaultOptions, question.material || "");
            }

            // Initialise
            this.appletInstance = new GGBApplet(defaultOptions, "5.0", true);
            // Render
            this.appletInstance.inject($modal[0], 'preferhtml5');

            this.$modal = $modal;
        },

        initReviewMode: function() {
            const api = this.api;
            const elements = api.getAllObjectNames();
            this.objectState = {};
            for (const element of elements) {
                if (element != "showsolution") {
                   this.objectState[element] = [api.isFixed(element),
                           api.isSelectionAllowed(element)];
                   api.setFixed(element, true, false);
                }
            }
        }

    });

    function GeoGebraScorer(question, response) {
        this.question = question;
        this.response = response;
    }

    /* Is the response correct?
     * @return boolean
     */
    GeoGebraScorer.prototype.isValid = function () {
        return !!(this.response && (this.response.fraction > 0));
    };

    /* The score for the current response.
     * @return float
     */
    GeoGebraScorer.prototype.score = function () {
        return this.response ? this.response.fraction * this.maxScore() : 0;
    };

    /* The maximum score for this question.
     * @return float
     */
    GeoGebraScorer.prototype.maxScore = function () {
        var responseScore = this.response ? parseFloat(this.response.max_score) : 0;
        return responseScore || parseFloat(this.question.max_score) || 1;
    };

    GeoGebraScorer.prototype.canValidateResponse = function () {
        return true;
    }

    return {
        Question: GeogebraExercise,
        Scorer: GeoGebraScorer
    };
});
function ggbOnInit() {
ggbApplet.setMode(7);
ggbApplet.registerAddListener("checkVector");
ggbApplet.setColor("C", 255, 0, 0);
}

function checkVector(vector){
v = ggbApplet.getValueString(vector);
if(v.slice(4,10) == '(7, 9)') {
ggbApplet.setValue("correct",1);
}
}
