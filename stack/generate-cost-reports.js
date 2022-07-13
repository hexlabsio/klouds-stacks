const aws = require('aws-sdk');
const response = require('cfn-response');
const crypto = require('crypto');

exports.handler = function(event, context) {
    if(event.RequestType === 'Create') {
        try {
            const properties = event.ResourceProperties;
            const bucket = properties.Bucket;
            const region = properties.Region;
            const reportName = `klouds-cost-reports${crypto.randomBytes(8).toString("hex")}`
            if(!bucket || !region) {
                console.log('Bucket or Region not provided');
                response.send(event, context, "FAILED", {});
            } else {
                const params = {
                    ReportDefinition: {
                        "ReportName": reportName,
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
                const cur = new aws.CUR({region: 'us-east-1'});
                cur.putReportDefinition(params, function (err, data) {
                    if (err) {
                        console.log(err, err.stack);
                        response.send(event, context, "FAILED", {});
                    }
                    else {
                        response.send(event, context, "SUCCESS", {
                            Bucket: properties.Bucket,
                            Region: properties.Region,
                            Prefix: "costs",
                            ReportName: reportName
                        });
                    }
                })

            }
        } catch (e) {
            console.error(e);
            response.send(event, context, "FAILED", {});
        }
    } else {
        response.send(event, context, "SUCCESS", {});
    }
}
