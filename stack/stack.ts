import {Template} from "@hexlabs/kloudformation-ts";
import {Role} from "@hexlabs/kloudformation-ts/dist/aws/iam/Role";
import {AWS} from "@hexlabs/kloudformation-ts/dist/kloudformation/aws";
import {Iam, iamPolicy, Policy} from "@hexlabs/kloudformation-ts/dist/kloudformation/iam/PolicyDocument";
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
  ReportBucket?: Value<string>;
  ReportBucketRegion?: Value<string>;
  ReportPrefix?: Value<string>;
  ReportName?: Value<string>;
}

function connectorRole(aws: AWS, uniqueId: Value<string>, principalId: Value<string>, externalId: Value<string>): Role {
  return aws.iamRole({
    roleName: join('klouds-connector-', uniqueId),
    assumeRolePolicyDocument: {
      statement: [{effect: 'Allow', principal: { AWS: [principalId]}, action: 'sts:AssumeRole', condition: { StringEquals: { _nocaps: true, 'sts:ExternalId': externalId}} }]
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
}

(function costReportsAndConnector() {
  Template.createWithParams({
    UniqueId: {type: 'String'},
    KloudsUserIdentifier: {
      type: 'String',
      description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'
    },
    ConnectorPrincipalId: {
      type: 'String',
      description: 'The principal that is allowed to assume this role, do not change.'
    },
    ConnectorExternalId: {
      type: 'String',
      description: 'The external id used to match the connector when assuming this role, do not change.'
    },
    ConnectorEndpoint: {
      type: 'String',
      description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.'
    }
  }, (aws, params) => {
    const bucket = aws.s3Bucket({bucketName: join('klouds-cost-reports-', params.UniqueId())});
    aws.s3BucketPolicy({
      bucket,
      policyDocument: iamPolicy({
        version: '2012-10-17', statement: [
          {
            effect: 'Allow',
            principal: {Service: ['billingreports.amazonaws.com']},
            action: ['s3:GetBucketAcl', 's3:GetBucketPolicy'],
            resource: bucket.attributes.Arn
          },
          {
            effect: 'Allow',
            principal: {Service: ['billingreports.amazonaws.com']},
            action: ['s3:PutObject'],
            resource: join(bucket.attributes.Arn, '/*')
          }
        ]
      })
    });
    const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
    Iam.from(role).add('CostReportPolicy', Policy.allow(['s3:ListBucket', 's3:GetObject'], [bucket.attributes.Arn, join(bucket.attributes.Arn, '/*')]));
    
    const lambda = Lambda.create(aws, 'klouds-cost-report-generator', {zipFile: fs.readFileSync('stack/generate-cost-reports.js').toString()}, 'index.handler', 'nodejs14.x', {functionName: join('klouds-cost-report-generator', params.UniqueId())});
    Iam.from(lambda.role).add('CostReportPolicy', Policy.allow(['cur:PutReportDefinition', 'cur:DescribeReportDefinitions'], '*'));
    
    const generator = aws.customResource('KloudsCostReportGenerator', {
      ServiceToken: lambda.lambda.attributes.Arn,
      Bucket: {Ref: bucket._logicalName},
      Region: {Ref: 'AWS::Region'}
    });
    aws.customResource<ConnectorRequest>('KloudsConnector', {
      _dependsOn: [bucket, generator],
      ServiceToken: params.ConnectorEndpoint(),
      RoleArn: role.attributes.Arn,
      UserIdentifier: params.KloudsUserIdentifier(),
      ReportBucket: {'Fn::GetAtt': [generator._logicalName, 'Bucket']} as any,
      ReportBucketRegion: {'Fn::GetAtt': [generator._logicalName, 'Region']} as any,
      ReportPrefix: {'Fn::GetAtt': [generator._logicalName, 'Prefix']} as any,
      ReportName: {'Fn::GetAtt': [generator._logicalName, 'ReportName']} as any,
    });
  
    return {
      outputs: {
        KloudsConnectorRoleArn: {description: 'Role used by kloud.io to read resources', value: role.attributes.Arn},
        KloudsReportBucket: {description: 'The bucket where AWS will create reports', value: {'Fn::GetAtt': [generator._logicalName, 'Bucket']} as any},
        KloudsReportBucketRegion: {description: 'The Region that the bucket exists in', value: {'Fn::GetAtt': [generator._logicalName, 'Region']} as any},
        KloudsReportPrefix: {description: 'A prefix applied to place reports into folders', value: {'Fn::GetAtt': [generator._logicalName, 'Prefix']} as any},
        KloudsReportName: {description: 'The name of the reports that will be generated by AWS', value: {'Fn::GetAtt': [generator._logicalName, 'ReportName']} as any},
      }
    }
  }, 'template/end-to-end.json', t => JSON.stringify({
    ...t,
    Description: 'Generates Cost and Usage Reports and creates a cross-account IAM Role with READONLY access for use by klouds.io'
  }, null, 2));
})();

(function costReportsWithReportDetails() {
  Template.createWithParams({
    UniqueId: {type: 'String'},
    KloudsUserIdentifier: {
      type: 'String',
      description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'
    },
    ConnectorPrincipalId: {
      type: 'String',
      description: 'The principal that is allowed to assume this role, do not change.'
    },
    ConnectorExternalId: {
      type: 'String',
      description: 'The external id used to match the connector when assuming this role, do not change.'
    },
    ConnectorEndpoint: {
      type: 'String',
      description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.'
    },
    ReportBucket: {
      type: 'String',
      description: ''
    },
    ReportBucketRegion: {
      type: 'String',
      description: ''
    },
    ReportPrefix: {
      type: 'String',
      description: ''
    },
    ReportName: {
      type: 'String',
      description: ''
    }
  }, (aws, params) => {
    const bucket = aws.s3Bucket({bucketName: join('klouds-cost-reports-', params.UniqueId())});
    aws.s3BucketPolicy({
      bucket,
      policyDocument: iamPolicy({
        version: '2012-10-17', statement: [
          {
            effect: 'Allow',
            principal: {Service: ['billingreports.amazonaws.com']},
            action: ['s3:GetBucketAcl', 's3:GetBucketPolicy'],
            resource: bucket.attributes.Arn
          },
          {
            effect: 'Allow',
            principal: {Service: ['billingreports.amazonaws.com']},
            action: ['s3:PutObject'],
            resource: join(bucket.attributes.Arn, '/*')
          }
        ]
      })
    });
    const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
    Iam.from(role).add('CostReportPolicy', Policy.allow(['s3:ListBucket', 's3:GetObject'], [bucket.attributes.Arn, join(bucket.attributes.Arn, '/*')]));

    aws.customResource<ConnectorRequest>('KloudsConnector', {
      _dependsOn: [bucket],
      ServiceToken: params.ConnectorEndpoint(),
      RoleArn: role.attributes.Arn,
      UserIdentifier: params.KloudsUserIdentifier(),
      ReportBucket: params.ReportBucket(),
      ReportBucketRegion:  params.ReportBucketRegion(),
      ReportPrefix:  params.ReportPrefix(),
      ReportName:  params.ReportName(),
    });

    return {
      outputs: {
        KloudsConnectorRoleArn: {description: 'Role used by kloud.io to read resources', value: role.attributes.Arn},
        KloudsReportBucket: {description: 'The bucket where AWS will create reports', value: params.ReportBucket() },
        KloudsReportBucketRegion: {description: 'The Region that the bucket exists in', value: params.ReportBucketRegion() },
        KloudsReportPrefix: {description: 'A prefix applied to place reports into folders', value: params.ReportPrefix() },
        KloudsReportName: {description: 'The name of the reports that will be generated by AWS', value: params.ReportName() },
      }
    }
  }, 'template/end-to-end-manual.json', t => JSON.stringify({
    ...t,
    Description: 'Generates Cost and Usage Reports and creates a cross-account IAM Role with READONLY access for use by klouds.io'
  }, null, 2));
})();

(function connectorOnly() {
  Template.createWithParams({
    UniqueId: {type: 'String'},
    KloudsUserIdentifier: {type: 'String', description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'},
    ConnectorPrincipalId: { type: 'String', description: 'The principal that is allowed to assume this role, do not change.' },
    ConnectorExternalId: { type: 'String', description: 'The external id used to match the connector when assuming this role, do not change.' },
    ConnectorEndpoint: { type: 'String', description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.' }
  }, (aws, params) => {
    
    const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
    
    aws.customResource<ConnectorRequest>('KloudsConnector', {
      ServiceToken: params.ConnectorEndpoint(),
      RoleArn: role.attributes.Arn,
      UserIdentifier: params.KloudsUserIdentifier()
    });
  
    return {
      outputs: {
        'KloudsConnectorRoleArn': {description: 'Role used by kloud.io to read resources', value: role.attributes.Arn}
      }
    }
  }, 'template/klouds-connector.json', t => JSON.stringify({...t, Description: 'Creates a cross-account IAM Role with READONLY access for use by klouds.io'}, null, 2));
  
  
})();

(function connectorWithBucket() {
  Template.createWithParams({
    UniqueId: {type: 'String'},
    KloudsUserIdentifier: {type: 'String', description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'},
    ConnectorPrincipalId: { type: 'String', description: 'The principal that is allowed to assume this role, do not change.' },
    ConnectorExternalId: { type: 'String', description: 'The external id used to match the connector when assuming this role, do not change.' },
    ConnectorEndpoint: { type: 'String', description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.' },
    ReportBucketName: { type: 'String', description: 'The bucket where cost reports are sent' },
  }, (aws, params) => {
    
    const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
    Iam.from(role).add('CostReportPolicy', Policy.allow(['s3:ListBucket', 's3:GetObject'], [
      join('arn:aws:s3:::', params.ReportBucketName()),
      join('arn:aws:s3:::', params.ReportBucketName(), '/*')
    ]));
    aws.customResource<ConnectorRequest>('KloudsConnector', {
      ServiceToken: params.ConnectorEndpoint(),
      RoleArn: role.attributes.Arn,
      UserIdentifier: params.KloudsUserIdentifier()
    });
    
    return {
      outputs: {
        'KloudsConnectorRoleArn': {description: 'Role used by kloud.io to read resources', value: role.attributes.Arn}
      }
    }
  }, 'template/klouds-connector-with-bucket.json', t => JSON.stringify({...t, Description: 'Creates a cross-account IAM Role with READONLY access for use by klouds.io'}, null, 2));
  
})();
