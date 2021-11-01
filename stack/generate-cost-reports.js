const aws = require('aws-sdk');
const response = require('cfn-response');
exports.handler = async function(event, context) {
    try {
        const params = {
            ReportDefinition: {
                "ReportName": "CostReport",
                "TimeUnit": "DAILY",
                "Format": "textORcsv",
                "Compression": "GZIP",
                "AdditionalSchemaElements": [
                    "RESOURCES"
                ],
                "S3Bucket": "xxxx-testbucket-2",
                "S3Prefix": "hexlabs",
                "S3Region": "eu-west-1",
                "AdditionalArtifacts": [],
                "RefreshClosedReports": true,
                "ReportVersioning": "OVERWRITE_REPORT"
            }
        }
        const cur = aws.CUR();
        await cur.putReportDefinition(params).promise();
        response.send(event, context, "SUCCESS", {});
    } catch(e) {
        console.error(e);
        response.send(event, context, "FAILED", {});
    }

}
