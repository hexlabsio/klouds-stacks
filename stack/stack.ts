import {Template} from "@hexlabs/kloudformation-ts";
import {Value} from "@hexlabs/kloudformation-ts/dist/kloudformation/Value";

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
  RoleName: { type: 'String', default: 'klouds-view-connector' },
  KloudsUserIdentifier: {type: 'String', description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'},
  ConnectorPrincipalId: { type: 'String', description: 'The principal that is allowed to assume this role, do not change.' },
  ConnectorExternalId: { type: 'String', description: 'The external id used to match the connector when assuming this role, do not change.' },
  ConnectorEndpoint: { type: 'String', description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.' },
}, (aws, params) => {
  const role = aws.iamRole({
    roleName: params.RoleName(),
    assumeRolePolicyDocument: {
      statement: [{effect: 'Allow', principal: { AWS: [params.ConnectorPrincipalId()]}, action: 'sts:AssumeRole', condition: { StringEquals: { 'sts:ExternalId': params.ConnectorExternalId()}} }]
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
}, 'template/template.json', t => JSON.stringify(({...t, Description: 'An IAM Role to grant READONLY access to klouds.io'})));
