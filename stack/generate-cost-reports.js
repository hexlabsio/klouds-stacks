const aws = require('aws-sdk');
const response = require('cfn-response');

exports.handler = async function(event, context) {
    if(event.RequestType === 'Create') {
        try {
            const properties = event.ResourceProperties;
            const bucket = properties.Bucket;
            const region = properties.Region;

            if(!bucket || !region) {
                console.log('Bucket or Region not provided');
                response.send(event, context, "FAILED", {});
                return;
            }
            const params = {
                ReportDefinition: {
                    "ReportName": "klouds-cost-reports",
                    "TimeUnit": "DAILY",
                    "Format": "textORcsv",
                    "Compression": "GZIP",
                    "AdditionalSchemaElements": [
                        "RESOURCES"
                    ],
                    "S3Bucket": properties.Bucket,
                    "S3Prefix": "costs",
                    "S3Region": properties.Region,
                    "AdditionalArtifacts": [],
                    "RefreshClosedReports": true,
                    "ReportVersioning": "OVERWRITE_REPORT"
                }
            }
            const cur = new aws.CUR();
            await cur.putReportDefinition(params).promise();
            response.send(event, context, "SUCCESS", {});
            return;
        } catch (e) {
            console.error(e);
            response.send(event, context, "FAILED", {});
            return;
        }
    }
    response.send(event, context, "SUCCESS", {});
}
ConnectorEndpoint	arn:aws:sns:eu-west-1:662158168835:klouds-connector-dev	-
ConnectorExternalId	741bef1f-594a-40a5-99b3-8fe3cf29e9a0	-
ConnectorPrincipalId	AROAZUK5T2MBYIITTXXAP	-
KloudsUserIdentifier	d7233049-1584-4de6-99c5-7150cb775a66	-
UniqueId	2398u328u39
