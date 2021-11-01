import {Template} from "@hexlabs/kloudformation-ts";
import {Iam, Policy} from "@hexlabs/kloudformation-ts/dist/kloudformation/iam/PolicyDocument";
import {Lambda} from "@hexlabs/kloudformation-ts/dist/kloudformation/modules/lambda";
import {join, Value} from "@hexlabs/kloudformation-ts/dist/kloudformation/Value";
import fs from 'fs';

Template.create(aws => {
  aws.s3Bucket({
    bucketName: 'klouds-user-template',
    websiteConfiguration: {
      indexDocument: 'template.json',
      errorDocument: 'template.json'
    }
  })
}, 'bucket.json');

export interface ConnectorRequest {
  RoleArn: Value<string>;
  UserIdentifier: Value<string>;
}

Template.createWithParams({
  UniqueId: {type: 'String'},
  KloudsUserIdentifier: {type: 'String', description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'},
  ConnectorPrincipalId: { type: 'String', description: 'The principal that is allowed to assume this role, do not change.' },
  ConnectorExternalId: { type: 'String', description: 'The external id used to match the connector when assuming this role, do not change.' },
  ConnectorEndpoint: { type: 'String', description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.' }
}, (aws, params) => {
  const bucket = aws.s3Bucket({ bucketName: join('klouds-cost-reports-', params.UniqueId()) });
  const role = aws.iamRole({
    roleName: join('klouds-connector-', params.UniqueId()),
    assumeRolePolicyDocument: {
      statement: [{effect: 'Allow', principal: { AWS: [params.ConnectorPrincipalId()]}, action: 'sts:AssumeRole', condition: { StringEquals: { _nocaps: true, 'sts:ExternalId': params.ConnectorExternalId()}} }]
    },
    managedPolicyArns: ['arn:aws:iam::aws:policy/SecurityAudit'],
    policies: [{
      policyName: 'APIGatewayGETDomainNamePolicy',
      policyDocument: {
        version: '2012-10-17',
        statement: [{action: 'apigateway:GET', effect: 'Allow', resource: [
            "arn:aws:apigateway:*::/domainnames",
            "arn:aws:apigateway:*::/domainnames/*",
            "arn:aws:apigateway:*::/domainnames/*/basepathmappings",
            "arn:aws:apigateway:*::/domainnames/*/basepathmappings/*"
          ]}]
      }
    }]
  });
  Iam.from(role)
    .add('CostReportPolicy', Policy.allow(['s3:ListBucket', 's3:GetObject'], bucket.attributes.Arn));
  const lambda = Lambda.create(aws, 'klouds-cost-report-generator',{
    zipFile: fs.readFileSync('stack/generate-cost-reports.js').toString()}, 'index.handler', 'nodejs14.x' );
  Iam.from(lambda.role)
  .add('CostReportPolicy', Policy.allow(['cur:PutReportDefinition', 'cur:DeleteReportDefinition'], '*'));
  const generator = aws.customResource('KloudsCostReportGenerator', {
    ServiceToken: lambda.lambda.attributes.Arn,
    Bucket: { Ref: bucket._logicalName },
    Region: { Ref: 'AWS::Region' }
  });
  aws.customResource<ConnectorRequest>('KloudsConnector', {
    _dependsOn: [bucket, generator],
    ServiceToken: params.ConnectorEndpoint(),
    RoleArn: role.attributes.Arn,
    UserIdentifier: params.KloudsUserIdentifier()
  });
  
  
}, 'template/with-cost-reports.json', t => JSON.stringify({...t, Description: 'Generates Cost and Usage Reports and creates a cross-account IAM Role with READONLY access for use by klouds.io'}, null, 2));

Template.createWithParams({
  RoleName: { type: 'String', default: 'klouds-view-connector' },
  KloudsUserIdentifier: {type: 'String', description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'},
  ConnectorPrincipalId: { type: 'String', description: 'The principal that is allowed to assume this role, do not change.' },
  ConnectorExternalId: { type: 'String', description: 'The external id used to match the connector when assuming this role, do not change.' },
  ConnectorEndpoint: { type: 'String', description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.' },
}, (aws, params) => {
  const role = aws.iamRole({
    roleName: params.RoleName(),
    assumeRolePolicyDocument: {
      statement: [{effect: 'Allow', principal: { AWS: [params.ConnectorPrincipalId()]}, action: 'sts:AssumeRole', condition: { StringEquals: { _nocaps: true, 'sts:ExternalId': params.ConnectorExternalId()}} }]
    },
    managedPolicyArns: ['arn:aws:iam::aws:policy/SecurityAudit'],
    policies: [{
      policyName: 'APIGatewayGETDomainNamePolicy',
      policyDocument: {
        version: '2012-10-17',
        statement: [{action: 'apigateway:GET', effect: 'Allow', resource: [
            "arn:aws:apigateway:*::/domainnames",
            "arn:aws:apigateway:*::/domainnames/*",
            "arn:aws:apigateway:*::/domainnames/*/basepathmappings",
            "arn:aws:apigateway:*::/domainnames/*/basepathmappings/*"
          ]}]
      }
    }]
  });
  aws.customResource<ConnectorRequest>('KloudsConnector', {
    ServiceToken: params.ConnectorEndpoint(),
    RoleArn: role.attributes.Arn,
    UserIdentifier: params.KloudsUserIdentifier()
  });
  return {
    outputs: {'RoleArn': {description: 'Role Arn', value: role.attributes.Arn}}
  }
}, 'template/template.json', t => JSON.stringify(({...t, Description: 'An IAM Role to grant READONLY access to klouds.io'})));
