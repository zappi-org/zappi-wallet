pipeline {
    agent any

    environment {
        IMAGE_NAME = 'zappi-wallet'
    }

    stages {
        stage('Build') {
            steps {
                checkout scm
                script {
                    if (env.BRANCH_NAME != 'main') {
                        error "This pipeline only runs on main branch: ${env.BRANCH_NAME}"
                    }
                    env.CHANNEL = buildingTag() ? 'main' : 'staging'
                }
                    sh """
                        docker build \
                            --build-arg VITE_ZAPPI_CHANNEL=${CHANNEL} \
                            -t ${IMAGE_NAME}:${BUILD_NUMBER} .
                    """
            }
        }

        stage('Deploy Staging') {
            when { not { buildingTag() } }
            steps {
                sh """
                    docker tag ${IMAGE_NAME}:${BUILD_NUMBER} ${IMAGE_NAME}:staging
                    docker compose -f docker-compose.staging.yml -p zappi-wallet-staging down || true
                    docker compose -f docker-compose.staging.yml -p zappi-wallet-staging up -d
                """
            }
        }

        stage('Approve Production') {
            when { buildingTag() }
            steps {
                input message: "Deploy ${TAG_NAME} to production?"
            }
        }

        stage('Deploy Production') {
            when { buildingTag() }
            steps {
                sh """
                    docker tag ${IMAGE_NAME}:${BUILD_NUMBER} ${IMAGE_NAME}:latest
                    docker compose -p zappi-wallet down || true
                    docker compose -p zappi-wallet up -d
                """
            }
        }
    }

    post {
        success {
            echo "SUCCESS: ${currentBuild.displayName} (${env.CHANNEL})"
        }
        failure {
            echo "FAILED: ${currentBuild.displayName}"
        }
        always {
            cleanWs()
        }
    }
}
