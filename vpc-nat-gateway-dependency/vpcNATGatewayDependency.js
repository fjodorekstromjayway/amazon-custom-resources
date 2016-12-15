'use strict';

const crypto = require('crypto');
const R = require('ramda');

const findSubnets = require('./lib/create-subnets');
const findNATGateway = require('./lib/create-nat-gateway');
const findInternetGateway = require('./lib/create-internet-gateway');
const findNATRouteTable = require('./lib/create-nat-route-table');
const findIGWRouteTable = require('./lib/create-igw-route-table');

const generateUniqueFunctionName = (event) => {
  const stackName = event.StackId.split(':')[5].split('/')[1];
  const name = stackName + '-' + event.LogicalResourceId + '-' + crypto.pseudoRandomBytes(6).toString('hex');
  return name.substring(0, 64);
};

const vpcNATGatewayDependecy = (event, callback) => {
  if (event.RequestType === 'Create') {
    event.PhysicalResourceId = generateUniqueFunctionName(event);
  }
  const initialState = {
    properties: event.ResourceProperties,
    callback: callback
  };

  const createAllMissingResources = R.composeP(findIGWRouteTable, findNATRouteTable, findInternetGateway, findNATGateway, findSubnets);
  return createAllMissingResources(initialState)
      .then(result => result.callback(null, result))
      .catch(initialState.callback);
};

const getReason = err => err ? err.message : '';

const createResponseBody = (event, context, status, data, err) => ({
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        PhysicalResourceId: event.PhysicalResourceId,
        Status: status,
        Reason: getReason(err) + ' See details in CloudWatch Log: ' + context.logStreamName,
        Data: data
    });

const createOptions = (event, context, status, data, err) => {
    const url = require('url');
    const responseBody = createResponseBody(event, context, status, data, err);

    console.log('RESPONSE:\n', responseBody);

    const parsedUrl = url.parse(event.ResponseURL);
    return {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: 'PUT',
        headers: {
            'content-type': '',
            'content-length': JSON.stringify(responseBody).length
        }
    };
};

const sendResponse = (event, context, status, data, err) => {
    const rp = require('request-promise');
    const options = createOptions(event, context, status, data, err);

    return rp(options)
        .then(response => {
            console.log('STATUS: ' + response.statusCode);
            console.log('HEADERS: ' + JSON.stringify(response.headers));
            context.done(null, data);
        })
        .finally(() => {
            return createResponseBody(event, context, status, data, err);
        })
        .catch(error => {
            console.log('sendResponse Error:\n', error);
            context.done(error);
        });
};

const usageExit = () => {
    const path = require('path');
    console.error('Usage: ' + path.basename(process.argv[1]) + ' json-array');
    process.exit(1);  //eslint-disable-line no-process-exit
};

const runVpcNATGatewayDependency = () => {
    console.log('called directly');
    if (process.argv.length < 3) {
        usageExit();
    }
    try {
        const data = JSON.parse(process.argv[2]);  //eslint-disable-line no-unused-vars
    } catch (error) {
        console.error('Invalid JSON', error);
        usageExit();
    }
    vpcNATGatewayDependecy(data, (err, res) => {    //eslint-disable-line no-undef
        console.log('Result', err, res);
    });

};

const calledDirectly = (require.main === module);

if (calledDirectly){
    runVpcNATGatewayDependency();
}

const eventHandler = (event, context) => {
    console.log(JSON.stringify(event, null, '  '));

    switch (event.RequestType) {
        case 'Delete':
            sendResponse(event, context, 'SUCCESS');
            break;
        default:
            vpcNATGatewayDependecy(event)
                .then(res => sendResponse(event, context, 'SUCCESS', res, {}))
                .catch(err => sendResponse(event, context, 'FAILED', {}, err));

            break;
    }
};

vpcNATGatewayDependecy.handler = eventHandler;
module.exports = vpcNATGatewayDependecy;


