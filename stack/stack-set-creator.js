const aws = require('aws-sdk');
const response = require('cfn-response');

async function runtime(event) {
    const { KloudsUserIdentifier, RootAccountId, UniqueId, Region, ReportName, ReportBucket, ReportBucketArn, ConnectorPrincipalId, ConnectorEndpoint, ConnectorExternalId } = event.ResourceProperties;
    const cloudformation = new aws.CloudFormation()
    const orgs = new aws.Organizations();
    console.log('Creating stack sets');
    await cloudformation.createStackSet({
        AutoDeployment: { Enabled: true, RetainStacksOnAccountRemoval: true },
        PermissionModel: "SERVICE_MANAGED",
        StackSetName: 'klouds-connector' + unique,
        TemplateURL: 'https://klouds-user-template.s3.eu-west-1.amazonaws.com/end-to-end-for-stack-set.json',
        Parameters: [
            { ParameterKey: 'UniqueId', ParameterValue: UniqueId },
            { ParameterKey: 'RootAccountId', ParameterValue: RootAccountId },
            { ParameterKey: 'KloudsUserIdentifier', ParameterValue: KloudsUserIdentifier },
            { ParameterKey: 'ConnectorPrincipalId', ParameterValue: ConnectorPrincipalId },
            { ParameterKey: 'ConnectorExternalId', ParameterValue: ConnectorExternalId },
            { ParameterKey: 'ConnectorEndpoint', ParameterValue: ConnectorEndpoint },
            { ParameterKey: 'ReportBucket', ParameterValue: ReportBucket },
            { ParameterKey: 'ReportBucketArn', ParameterValue: ReportBucketArn },
            { ParameterKey: 'ReportBucketRegion', ParameterValue: Region },
            { ParameterKey: 'ReportName', ParameterValue: ReportName }
        ]
    }).promise();
    console.log('Checking orgs');
    const organisations = await orgs.describeOrganization().promise();
    console.log('Creating stack set instances');
    await cloudformation.createStackInstances({
        StackSetName: 'klouds-connector' + UniqueId,
        Regions: ['us-east-1'],
        DeploymentTargets: {
            OrganizationalUnitIds: [organisations.Organization.Id]
        }
    }).promise();
}

exports.handler = function(event, context) {
    if(event.RequestType === 'Create') {
        try {
            runtime(event).then(() => response.send(event, context, "SUCCESS", {}))
                .catch(e => {
                    console.error(e);
                    response.send(event, context, "FAILED", {});
                })
            response.send(event, context, "SUCCESS", {});
        } catch (e) {
            console.error(e);
            response.send(event, context, "FAILED", {});
        }
    } else {
        response.send(event, context, "SUCCESS", {});
    }
}
