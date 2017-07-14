/**
 * MobileCaddyForce Factory
 *
 * @description Service for calling generic Salesforce REST endpoints.
 *              When running in Codeflow it uses the forcejs, otherwise we call
 *              using the $http service.
 * sync status.
 */
(function() {
  'use strict';

  angular
    .module('starter.services')
    .factory('McRestService', McRestService);

  McRestService.$inject = ['devUtils', 'logger', '$http', 'syncRefresh', 'appDataUtils'];

  function McRestService(devUtils, logger, $http, syncRefresh,appDataUtils) {

    var logModule = "app.McRestService";
    var oauth;
    var failCount = 0;
    var apiVersion = "v36.0";

    return {
      query: query,

      request: request,

      requestBuffer: requestBuffer,

      upload: upload
    };


    function query(soql) {
      return new Promise(function(resolve, reject) {
        request({ path: '/services/data/' + apiVersion + '/query',
                  params: {q: soql}
        }).then(function(result){
          resolve(result);
        }).catch(function(e){
          logger.error(e);
          reject(e);
        });
      });
    }


    /**
     * Sets up our oauth object from the appSoup. We should only need to do this
     * every now and again as it's a singleton.
     * TODO - At the moment we use the 'appDataUtils', but really we should provide
     *   a non-cached read call into the devUtils. What's here is more of a proof
     *   of concept.
     */
    function setUpOauth() {
      return new Promise(function(resolve, reject) {
        if (oauth) {
          resolve();
        } else {
          console.log("Getting oauth details from appSoup");
          appDataUtils.getCurrentValueFromAppSoup('accessToken').then(function(accessToken){
            oauth = {'accessToken': accessToken};
            return appDataUtils.getCurrentValueFromAppSoup('refreshToken');
          }).then(function(refreshToken){
            oauth.refreshToken = refreshToken;
            return devUtils.getCachedAppSoupValue('instanceUrl');
          }).then(function(instanceUrl){
            oauth.instanceUrl = instanceUrl;
            resolve();
          }).catch(function(e){
            oauth = null;
            logger.error(e);
            reject(e);
          });
        }
      });
    }


    function request(obj) {
      return new Promise(function(resolve, reject) {
        if (! window.LOCAL_DEV) {
          setUpOauth().then(function(){
            return doRequest(obj);
          }).then(function(r){
            failCount = 0;
            resolve(r);
          }).catch(function(e){
            console.error(logModule, 'request failed', e);
            if (failCount > 0) {
              failCount = 0;
              reject(e);
            } else {
              failCount ++;
              syncRefresh.refreshToken(
                function() {
                  console.info("refreshToken success");
                  return request(obj);
                },
                function(e) {
                  console.error("refreshToken failed", e);
                  reject(e);
                }
              );
            }
          });
        } else { // Use our already instatiated forcejs
          forcejsRequest(obj).then(function(r){
            resolve(r);
          }).catch(function(e){
            console.error("doRequest", e);
            reject(e);
          });
        }
      });
    }


    function upload(file) {
      return new Promise(function(resolve, reject) {
        if (! window.LOCAL_DEV) {
          setUpOauth().then(function(){
            return doUpload(file);
          }).then(function(result){
            console.log(logModule, "doUpload Result", result);
            resolve(result);
          }).catch(function(e){
            logger.error(logModule, 'oauth setup failed', e);
            reject(e);
          });
        } else {
          // Use our already instatiated forcejs
          forcejsUpload(file).then(function(result){
            resolve(result);
          }).catch(function(e){
            logger.error(e);
            reject(e);
          });
        }
      });
    }


    function forcejsUpload(file) {
      return new Promise(function(resolve, reject) {
        console.log("upload");
        var uploadUrl  = 'http://localhost:3000' + '/services/data/v40.0/connect/files/users/me';
        var forceOauth = JSON.parse(localStorage.getItem('forceOAuth'));
        var headers = {'Content-Type': undefined, 'Target-URL':forceOauth.instance_url};
        headers.Authorization = "Bearer " + forceOauth.access_token;

        var fd = new FormData();
        fd.append('fileData', file);
        fd.append('desc', 'A file I want to upload');
        fd.append('title', 'My File'); // Note: if we live this blank it will take the local filename
        $http.post(uploadUrl, fd, {
           transformRequest: angular.identity,
           headers: headers
        })
        .success(function(res){
          console.log("success");
          resolve(res);
        })
        .error(function(e){
          console.error(e);
          reject(e);
        });
      });
    }

    function doUpload(file) {
      return new Promise(function(resolve, reject) {
        console.log("upload");
        var uploadUrl  = oauth.instanceUrl + '/services/data/v40.0/connect/files/users/me';

        var headers = {'Content-Type': undefined};
        headers.Authorization = "Bearer " + oauth.accessToken;

        var fd = new FormData();
        fd.append('fileData', file);
        fd.append('desc', 'A file I want to upload');
        fd.append('title', 'My File'); // Note: if we live this blank it will take the local filename
        $http.post(uploadUrl, fd, {
           transformRequest: angular.identity,
           headers: headers
        })
        .success(function(res){
          console.log("success");
          resolve(res);
        })
        .error(function(e){
          console.error(e);
          reject(e);
        });
      });
    }

    function forcejsRequest(obj) {
      return new Promise(function(resolve, reject) {
        force.request(obj,
          function(resp) {
            console.log(logModule, resp);
            resolve(resp);
          },
          function(e) {
            console.error(logModule, 'forcejs Failed',e);
            reject(e);
          }
        );
      });
    }

    function doRequest(obj){
      return new Promise(function(resolve, reject) {
        console.log(logModule, "oauth", oauth);
        var method = obj.method || 'GET',
            headers = {};

        // dev friendly API: Add leading '/' if missing so url + path concat always works
        if (obj.path.charAt(0) !== '/') {
          obj.path = '/' + obj.path;
        }

        var url = oauth.instanceUrl + obj.path;

        headers.Authorization = "Bearer " + oauth.accessToken;
        if (obj.contentType) {
          headers["Content-Type"] = obj.contentType;
        }
        console.log(logModule, "request headers: "+JSON.stringify(headers));
        console.log(logModule, "request url: "+url);

        $http({
          headers: headers,
          method: method,
          url: url,
          params: obj.params,
          data: obj.data
        }).success(function (data, status, headers, config) {
          resolve(data);
        }).error(function (data, status, headers, config, statusText) {
          // Weird here as looks like SF does not return CORS headers for non  200
          if (status === 0 && !data && !statusText) {
            oauth = null;
            reject('$http failed with status code 0');
          } else {
            reject(data);
          }
        });
      });
    }

    function requestBuffer(obj){
      return new Promise(function(resolve, reject) {
        console.log(logModule, "oauth", oauth);
        var method = obj.method || 'GET',
            headers = {};

        // dev friendly API: Add leading '/' if missing so url + path concat always works
        if (obj.path.charAt(0) !== '/') {
          obj.path = '/' + obj.path;
        }

        var url = oauth.instanceUrl + obj.path;

        headers.Authorization = "Bearer " + oauth.accessToken;
        if (obj.contentType) {
          headers["Content-Type"] = obj.contentType;
        }
        console.log(logModule, "request headers: "+JSON.stringify(headers));
        console.log(logModule, "request url: "+url);

        $http({
          headers: headers,
          method: method,
          url: url,
          params: obj.params,
          responseType: "arraybuffer",
          data: obj.data
        }).success(function (data, status, headers, config) {
          resolve(data);
        }).error(function (data, status, headers, config, statusText) {
          // Weird here as looks like SF does not return CORS headers for non  200
          if (status === 0 && !data && !statusText) {
            oauth = null;
            reject('$http failed with status code 0');
          } else {
            reject(data);
          }
        });
      });
    }


  }

})();
/**
 * AppRunStatus Factory
 *
 * @description Handles app status events such as "resume" etc.
 */
(function() {
  'use strict';

  angular
    .module('starter.services')
    .factory('AppRunStatusService', AppRunStatusService);

  AppRunStatusService.$inject = ['$ionicPopup', '$ionicLoading', 'devUtils', 'vsnUtils', 'SyncService', 'logger'];

  function AppRunStatusService($ionicPopup, $ionicLoading, devUtils, vsnUtils, SyncService, logger) {

	 return {
	    statusEvent: function(status){
	      logger.log('AppRunStatusService status ' + status);
	      if (status == "resume") {
	        // resume();
	      }
	    }
	  };

	  function resume() {
	    devUtils.dirtyTables().then(function(tables){
	      logger.log('on resume: dirtyTables check');
	      if (tables && tables.length === 0) {
	        logger.log('on resume: calling upgradeAvailable');
	        vsnUtils.upgradeAvailable().then(function(res){
	          logger.log('on resume: upgradeAvailable? ' + res);
	          if (res) {
	            var notificationTimeout = (1000 * 60 * 5); // 5 minutes
	            var prevUpNotification = localStorage.getItem('prevUpNotification');
	            var timeNow = Date.now();
	            if (prevUpNotification === null) {
	              prevUpNotification = 0;
	            }
	            if (parseInt(prevUpNotification) < (timeNow - notificationTimeout)){
	              var confirmPopup = $ionicPopup.confirm({
	                title: 'Upgrade available',
	                template: 'Would you like to upgrade now?',
	                cancelText: 'Not just now',
	                okText: 'Yes'
	              });
	              confirmPopup.then(function(res) {
	                if(res) {
	                  $ionicLoading.show({
	                    duration: 30000,
	                    delay : 400,
	                    maxWidth: 600,
	                    noBackdrop: true,
	                    template: '<h1>Upgrade app...</h1><p id="app-upgrade-msg" class="item-icon-left">Upgrading...<ion-spinner/></p>'
	                  });
	                  localStorage.removeItem('prevUpNotification');
	                  logger.log('on resume: calling upgradeIfAvailable');
	                  vsnUtils.upgradeIfAvailable().then(function(res){
	                    logger.log('on resume: upgradeIfAvailable res = ' + res);
	                    //console.log('upgradeIfAvailable', res);
	                    if (!res) {
	                      $ionicLoading.hide();
	                      $scope.data = {};
	                      $ionicPopup.show({
	                        title: 'Upgrade',
	                        subTitle: 'The upgrade could not take place due to sync in progress. Please try again later.',
	                        scope: $scope,
	                        buttons: [
	                          {
	                            text: 'OK',
	                            type: 'button-positive',
	                            onTap: function(e) {
	                              return true;
	                            }
	                          }
	                        ]
	                      });
	                    }
	                  }).catch(function(e){
	                    logger.error("resume " + JSON.stringify(e));
	                    $ionicLoading.hide();
	                  });
	                } else {
	                  localStorage.setItem('prevUpNotification', timeNow);
	                }
	              });
	            }
	          }
	        });
	      } else {
	        logger.log('on resume: dirtyTables found');
	      }
	    });
	    return true;
	  }
  }

})();