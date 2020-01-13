import io.hexlabs.kloudformation.module.s3.s3Website
import io.kloudformation.KloudFormation
import io.kloudformation.StackBuilder
import io.kloudformation.model.iam.action
import io.kloudformation.model.iam.policyDocument
import io.kloudformation.model.iam.resources
import io.kloudformation.property.aws.iam.user.Policy
import io.kloudformation.resource.aws.iam.user
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