import io.hexlabs.kloudformation.module.s3.s3Website
import io.kloudformation.KloudFormation
import io.kloudformation.StackBuilder
import io.kloudformation.resource.aws.iam.user

class BucketStack: StackBuilder {
    override fun KloudFormation.create(args: List<String>) {
        s3Website {
            s3Bucket {
                bucketName("klouds-user-template")
                websiteConfiguration {
                    indexDocument("template.yml")
                    errorDocument("template.yml")
                }
            }
        }
    }
}


class IamStack: StackBuilder {
    override fun KloudFormation.create(args: List<String>) {
        user()
    }
}