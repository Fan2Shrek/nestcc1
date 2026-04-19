<?php

use Twig\Environment;
use Twig\Loader\FilesystemLoader;

require_once __DIR__.'/vendor/autoload.php';

$loader = new FilesystemLoader(__DIR__.'/templates');

$twig = new Environment($loader);

$apiBaseUrl = getenv('API_BASE_URL') ?: 'http://localhost:3000';

echo $twig->render('index.html.twig', [
	'api_base_url' => $apiBaseUrl,
]);
