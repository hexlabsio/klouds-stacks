import io.hexlabs.kloudformation.module.s3.s3Website
import io.kloudformation.KloudFormation
import io.kloudformation.StackBuilder
import io.kloudformation.function.plus
import io.kloudformation.model.iam.PrincipalType
import io.kloudformation.model.iam.action
import io.kloudformation.model.iam.actions
import io.kloudformation.model.iam.policyDocument
import io.kloudformation.model.iam.resource
import io.kloudformation.model.iam.resources
import io.kloudformation.property.aws.iam.user.Policy
import io.kloudformation.resource.aws.iam.user
import io.kloudformation.resource.aws.s3.bucket
import io.kloudformation.resource.aws.s3.bucketPolicy
import io.kloudformation.unaryPlus

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
        s3Website {
            s3Bucket {
                bucketName("klouds-billing-bucket-template")
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
        this.description = "This Stack will create an IAM user with read access to AWS services across your account"
        val userName = parameter<String>("UserName", default = "klouds-user").ref()
        user{
            userName(userName)
            managedPolicyArns(listOf(+"arn:aws:iam::aws:policy/SecurityAudit"))
            policies(listOf(Policy(
                policyName = +"APIGatewayGETDomainNamePolicy",
                policyDocument = policyDocument {
                    statement(
                        action = action("apigateway:GET"),
                        resource = resources(
                            "arn:aws:apigateway:*::/domainnames",
                            "arn:aws:apigateway:*::/domainnames/*",
                            "arn:aws:apigateway:*::/domainnames/*/basepathmappings",
                            "arn:aws:apigateway:*::/domainnames/*/basepathmappings/*"
                        )
                    )
                }
            )))
        }
    }
}

class BillingBucketStack: StackBuilder {
    override fun KloudFormation.create(args: List<String>) {
        this.description = "This Stack will create a bucket that can be used to store your billing reports"
        val bucketName = parameter<String>("BucketName").ref()
        val kloudsAccount = parameter<String>("KloudsAccount", default = "662158168835")
        val bucket = bucket {
            bucketName(bucketName)
        }
        bucketPolicy(bucket.Arn(), policyDocument {
            statement(
                    action = actions("s3:GetBucketLocation", "s3:ListBucket"),
                    resource = resource(bucket.Arn())
            ) {
                principal(PrincipalType.AWS, listOf(+"arn:aws:iam::" + kloudsAccount.ref() + ":root"))
            }
            statement(
                    action = action("s3:GetObject"),
                    resource = resource(bucket.Arn() + "/*")
            ) {
                principal(PrincipalType.AWS, listOf(+"arn:aws:iam::" + kloudsAccount.ref() + ":root"))
            }
        })
    }
}