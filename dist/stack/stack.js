"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const kloudformation_ts_1 = require("@hexlabs/kloudformation-ts");
const PolicyDocument_1 = require("@hexlabs/kloudformation-ts/dist/kloudformation/iam/PolicyDocument");
const lambda_1 = require("@hexlabs/kloudformation-ts/dist/kloudformation/modules/lambda");
const Value_1 = require("@hexlabs/kloudformation-ts/dist/kloudformation/Value");
const fs_1 = __importDefault(require("fs"));
kloudformation_ts_1.Template.create(aws => {
    aws.s3Bucket({
        bucketName: 'klouds-user-template',
        websiteConfiguration: {
            indexDocument: 'template.json',
            errorDocument: 'template.json'
        }
    });
}, 'bucket.json');
function connectorRole(aws, uniqueId, principalId, externalId) {
    return aws.iamRole({
        roleName: Value_1.join('klouds-connector-', uniqueId),
        assumeRolePolicyDocument: {
            statement: [{ effect: 'Allow', principal: { AWS: [principalId] }, action: 'sts:AssumeRole', condition: { StringEquals: { _nocaps: true, 'sts:ExternalId': externalId } } }]
        },
        managedPolicyArns: ['arn:aws:iam::aws:policy/SecurityAudit'],
        policies: [{
                policyName: 'APIGatewayGETDomainNamePolicy',
                policyDocument: {
                    version: '2012-10-17',
                    statement: [{ action: 'apigateway:GET', effect: 'Allow', resource: [
                                "arn:aws:apigateway:*::/domainnames",
                                "arn:aws:apigateway:*::/domainnames/*",
                                "arn:aws:apigateway:*::/domainnames/*/basepathmappings",
                                "arn:aws:apigateway:*::/domainnames/*/basepathmappings/*"
                            ] }]
                }
            }]
    });
}
(function costReportsAndConnector() {
    kloudformation_ts_1.Template.createWithParams({
        UniqueId: { type: 'String' },
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
        const bucket = aws.s3Bucket({ bucketName: Value_1.join('klouds-cost-reports-', params.UniqueId()) });
        aws.s3BucketPolicy({
            bucket,
            policyDocument: PolicyDocument_1.iamPolicy({
                version: '2012-10-17', statement: [
                    {
                        effect: 'Allow',
                        principal: { Service: ['billingreports.amazonaws.com'] },
                        action: ['s3:GetBucketAcl', 's3:GetBucketPolicy'],
                        resource: bucket.attributes.Arn
                    },
                    {
                        effect: 'Allow',
                        principal: { Service: ['billingreports.amazonaws.com'] },
                        action: ['s3:PutObject'],
                        resource: Value_1.join(bucket.attributes.Arn, '/*')
                    }
                ]
            })
        });
        const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
        PolicyDocument_1.Iam.from(role).add('CostReportPolicy', PolicyDocument_1.Policy.allow(['s3:ListBucket', 's3:GetObject'], [bucket.attributes.Arn, Value_1.join(bucket.attributes.Arn, '/*')]));
        const lambda = lambda_1.Lambda.create(aws, 'klouds-cost-report-generator', { zipFile: fs_1.default.readFileSync('stack/generate-cost-reports.js').toString() }, 'index.handler', 'nodejs14.x', { functionName: Value_1.join('klouds-cost-report-generator', params.UniqueId()) });
        PolicyDocument_1.Iam.from(lambda.role).add('CostReportPolicy', PolicyDocument_1.Policy.allow(['cur:PutReportDefinition', 'cur:DescribeReportDefinitions'], '*'));
        const generator = aws.customResource('KloudsCostReportGenerator', {
            ServiceToken: lambda.lambda.attributes.Arn,
            Bucket: { Ref: bucket._logicalName },
            Region: { Ref: 'AWS::Region' }
        });
        aws.customResource('KloudsConnector', {
            _dependsOn: [bucket, generator],
            ServiceToken: params.ConnectorEndpoint(),
            RoleArn: role.attributes.Arn,
            UserIdentifier: params.KloudsUserIdentifier(),
            ReportBucket: { 'Fn::GetAtt': [generator._logicalName, 'Bucket'] },
            ReportBucketRegion: { 'Fn::GetAtt': [generator._logicalName, 'Region'] },
            ReportPrefix: { 'Fn::GetAtt': [generator._logicalName, 'Prefix'] },
            ReportName: { 'Fn::GetAtt': [generator._logicalName, 'ReportName'] },
        });
        return {
            outputs: {
                KloudsConnectorRoleArn: { description: 'Role used by kloud.io to read resources', value: role.attributes.Arn },
                KloudsReportBucket: { description: 'The bucket where AWS will create reports', value: { 'Fn::GetAtt': [generator._logicalName, 'Bucket'] } },
                KloudsReportBucketRegion: { description: 'The Region that the bucket exists in', value: { 'Fn::GetAtt': [generator._logicalName, 'Region'] } },
                KloudsReportPrefix: { description: 'A prefix applied to place reports into folders', value: { 'Fn::GetAtt': [generator._logicalName, 'Prefix'] } },
                KloudsReportName: { description: 'The name of the reports that will be generated by AWS', value: { 'Fn::GetAtt': [generator._logicalName, 'ReportName'] } },
            }
        };
    }, 'template/end-to-end.json', t => JSON.stringify({
        ...t,
        Description: 'Generates Cost and Usage Reports and creates a cross-account IAM Role with READONLY access for use by klouds.io'
    }, null, 2));
})();
(function connectorOnly() {
    kloudformation_ts_1.Template.createWithParams({
        UniqueId: { type: 'String' },
        KloudsUserIdentifier: { type: 'String', description: 'A temporary ID used to refer back to the user that requested this in app, do not change.' },
        ConnectorPrincipalId: { type: 'String', description: 'The principal that is allowed to assume this role, do not change.' },
        ConnectorExternalId: { type: 'String', description: 'The external id used to match the connector when assuming this role, do not change.' },
        ConnectorEndpoint: { type: 'String', description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.' }
    }, (aws, params) => {
        const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
        aws.customResource('KloudsConnector', {
            ServiceToken: params.ConnectorEndpoint(),
            RoleArn: role.attributes.Arn,
            UserIdentifier: params.KloudsUserIdentifier()
        });
        return {
            outputs: {
                'KloudsConnectorRoleArn': { description: 'Role used by kloud.io to read resources', value: role.attributes.Arn }
            }
        };
    }, 'template/klouds-connector.json', t => JSON.stringify({ ...t, Description: 'Creates a cross-account IAM Role with READONLY access for use by klouds.io' }, null, 2));
})();
(function connectorWithBucket() {
    kloudformation_ts_1.Template.createWithParams({
        UniqueId: { type: 'String' },
        KloudsUserIdentifier: { type: 'String', description: 'A temporary ID used to refer back to the user that requested this in app, do not change.' },
        ConnectorPrincipalId: { type: 'String', description: 'The principal that is allowed to assume this role, do not change.' },
        ConnectorExternalId: { type: 'String', description: 'The external id used to match the connector when assuming this role, do not change.' },
        ConnectorEndpoint: { type: 'String', description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.' },
        ReportBucketName: { type: 'String', description: 'The bucket where cost reports are sent' },
    }, (aws, params) => {
        const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
        PolicyDocument_1.Iam.from(role).add('CostReportPolicy', PolicyDocument_1.Policy.allow(['s3:ListBucket', 's3:GetObject'], [
            Value_1.join('arn:aws:s3:::', params.ReportBucketName()),
            Value_1.join('arn:aws:s3:::', params.ReportBucketName(), '/*')
        ]));
        aws.customResource('KloudsConnector', {
            ServiceToken: params.ConnectorEndpoint(),
            RoleArn: role.attributes.Arn,
            UserIdentifier: params.KloudsUserIdentifier()
        });
        return {
            outputs: {
                'KloudsConnectorRoleArn': { description: 'Role used by kloud.io to read resources', value: role.attributes.Arn }
            }
        };
    }, 'template/klouds-connector-with-bucket.json', t => JSON.stringify({ ...t, Description: 'Creates a cross-account IAM Role with READONLY access for use by klouds.io' }, null, 2));
})();
