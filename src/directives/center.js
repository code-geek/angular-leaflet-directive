angular.module('leaflet-directive').directive('lfCenter', function(leafletLogger, $q, $location, $timeout, leafletMapDefaults, leafletHelpers, leafletBoundsHelpers, leafletMapEvents) {
  var isDefined = leafletHelpers.isDefined;
  var isNumber = leafletHelpers.isNumber;
  var isSameCenterOnMap = leafletHelpers.isSameCenterOnMap;
  var safeApply = leafletHelpers.safeApply;
  var isValidCenter = leafletHelpers.isValidCenter;
  var isValidBounds = leafletBoundsHelpers.isValidBounds;
  var isUndefinedOrEmpty = leafletHelpers.isUndefinedOrEmpty;

  var shouldInitializeMapWithBounds = function(bounds, center) {
    return isDefined(bounds) && isValidBounds(bounds) && isUndefinedOrEmpty(center);
  };

  var _leafletCenter;
  return {
    restrict: 'A',
    scope: false,
    replace: false,
    require: 'leaflet',
    controller: function() {
      _leafletCenter = $q.defer();
      this.getCenter = function() {
        return _leafletCenter.promise;
      };
    },

    link: function(scope, element, attrs, controller) {
      var leafletScope = controller.getLeafletScope();

      if (!isDefined(leafletScope.center)) {
        leafletLogger.error('The scope "center" variable is not defined', 'center');
        leafletScope.center = {};
      }

      var centerModel = leafletScope.center;
      controller.getMap().then(function(map) {
        var defaults = leafletMapDefaults.getDefaults(attrs.id);

        if (attrs.lfCenter.search('-') !== -1) {
          leafletLogger.error('The "center" variable can\'t use a "-" on its key name: "' + attrs.lfCenter, 'center');
          map.setView([defaults.center.lat, defaults.center.lng], defaults.center.zoom);
          return;
        } else if (shouldInitializeMapWithBounds(leafletScope.bounds, centerModel)) {
          map.fitBounds(leafletBoundsHelpers.createLeafletBounds(leafletScope.bounds), leafletScope.bounds.options);
          safeApply(leafletScope, function(scope) {
            angular.extend(scope.center, {
              lat: map.getCenter().lat,
              lng: map.getCenter().lng,
              zoom: map.getZoom(),
              autoDiscover: false,
            });
          });

          safeApply(leafletScope, function(scope) {
            var mapBounds = map.getBounds();
            scope.bounds = {
              northEast: {
                lat: mapBounds._northEast.lat,
                lng: mapBounds._northEast.lng,
              },
              southWest: {
                lat: mapBounds._southWest.lat,
                lng: mapBounds._southWest.lng,
              },
            };
          });
        } else if (!isDefined(centerModel)) {
          leafletLogger.error('The "center" property is not defined in the main scope', 'center');
          map.setView([defaults.center.lat, defaults.center.lng], defaults.center.zoom);
          return;
        } else if (!(isDefined(centerModel.lat) && isDefined(centerModel.lng)) && !isDefined(centerModel.autoDiscover)) {
          angular.copy(defaults.center, centerModel);
        }

        var urlCenterHash;
        var mapReady;
        if (centerModel.allowUrlHashCenter === true) {
          var extractCenterFromUrl = function() {
            var search = $location.search();
            var centerParam;
            if (isDefined(search.c)) {
              var cParam = search.c.split(':');
              if (cParam.length === 3) {
                centerParam = {
                  lat: parseFloat(cParam[0]),
                  lng: parseFloat(cParam[1]),
                  zoom: parseInt(cParam[2], 10),
                  allowUrlHashCenter: centerModel.allowUrlHashCenter,
                };
              }
            }

            return centerParam;
          };

          urlCenterHash = extractCenterFromUrl();

          leafletScope.$on('$locationChangeSuccess', function(event) {
            var scope = event.currentScope;

            var urlCenter = extractCenterFromUrl();
            if (isDefined(urlCenter) && !isSameCenterOnMap(urlCenter, map)) {
              angular.extend(scope.center, {
                lat: urlCenter.lat,
                lng: urlCenter.lng,
                zoom: urlCenter.zoom,
                allowUrlHashCenter: centerModel.allowUrlHashCenter,
              });
            }
          });
        }

        leafletScope.$watch('center', function(center) {
          if (leafletScope.settingCenterFromLeaflet) {
            return;
          }

          // The center from the URL has priority
          if (isDefined(urlCenterHash)) {
            angular.copy(urlCenterHash, center);
            urlCenterHash = undefined;
          }

          if (!isValidCenter(center) && center.autoDiscover !== true) {
            leafletLogger.warn(' invalid \'center\'', 'center');

            //map.setView([defaults.center.lat, defaults.center.lng], defaults.center.zoom);
            return;
          }

          if (center.autoDiscover === true) {
            if (!isNumber(center.zoom)) {
              map.setView([defaults.center.lat, defaults.center.lng], defaults.center.zoom);
            }

            if (isNumber(center.zoom) && center.zoom > defaults.center.zoom) {
              map.locate({
                setView: true,
                maxZoom: center.zoom,
              });
            } else if (isDefined(defaults.maxZoom)) {
              map.locate({
                setView: true,
                maxZoom: defaults.maxZoom,
              });
            } else {
              map.locate({
                setView: true,
              });
            }

            return;
          }

          if (mapReady && isSameCenterOnMap(center, map)) {
            return;
          }

          leafletScope.settingCenterFromScope = true;
          map.setView([center.lat, center.lng], center.zoom);
          leafletMapEvents.notifyCenterChangedToBounds(leafletScope, map);
          $timeout(function() {
                leafletScope.settingCenterFromScope = false;
              });
        }, true);

        map.whenReady(function() {
          mapReady = true;
        });

        map.on('moveend', function(/* event */) {
          // Resolve the center after the first map position
          _leafletCenter.resolve();

          if (centerModel.allowUrlHashCenter === true) {
            leafletMapEvents.notifyCenterUrlHashChanged(leafletScope, map, $location.search());
          }

          if (isSameCenterOnMap(centerModel, map) || leafletScope.settingCenterFromScope) {
            return;
          }

          leafletScope.settingCenterFromLeaflet = true;
          safeApply(leafletScope, function(scope) {
            if (!leafletScope.settingCenterFromScope) {
              angular.extend(scope.center, {
                lat: map.getCenter().lat,
                lng: map.getCenter().lng,
                zoom: map.getZoom(),
                autoDiscover: false,
              });
            }

            leafletMapEvents.notifyCenterChangedToBounds(leafletScope, map);
            $timeout(function() {
              leafletScope.settingCenterFromLeaflet = false;
            });
          });
        });

        if (centerModel.autoDiscover === true) {
          map.on('locationerror', function() {
            leafletLogger.warn('The Geolocation API is unauthorized on this page.', 'center');
            if (isValidCenter(centerModel)) {
              map.setView([centerModel.lat, centerModel.lng], centerModel.zoom);
              leafletMapEvents.notifyCenterChangedToBounds(leafletScope, map);
            } else {
              map.setView([defaults.center.lat, defaults.center.lng], defaults.center.zoom);
              leafletMapEvents.notifyCenterChangedToBounds(leafletScope, map);
            }
          });
        }
      });
    },
  };
});
