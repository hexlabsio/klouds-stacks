import {Template} from "@hexlabs/kloudformation-ts";

Template.create(aws => {
  aws.s3Bucket({
    bucketName: 'klouds-user-template',
    websiteConfiguration: {
      indexDocument: 'template.json',
      errorDocument: 'template.json'
    }
  })
}, 'bucket.json');

Template.createWithParams({
  UserName: { type: 'String', default: 'klouds-user' }
}, (aws, params) => {
  aws.iamUser({
    userName: params.UserName(),
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
  })
}, 'template/template.json');
